/*
 * The Smith moved onto perks: its eighteen, on the island.
 *
 * The fifth trade off its tree (`PERK_CLASSES`). Its perks are rows the
 * definitions already carry (`class_perk`), as are the ingots, the two new
 * jobs (`pour_ingot`, `quench_item`) and the ingots among what Improve takes
 * for metal (`improve_stock`). What is here is every rule the perks change,
 * each reading its key off the fold with the rule's own number as the
 * default, so that for anybody without the perk nothing moves:
 *
 *   * the anvil (`perform_forge`): Sure Hammer fails half as often at Smith
 *     and Strike coins (`fail:`); Second Heat rolls before the casting is
 *     spent and keeps it on a failure (`spare:smith`); Nail Maker beats out
 *     more to a filling (`count:` and the piece); Toolsmith's heads and blades
 *     come out better (`ql:` and the piece); and what the anvil beats out
 *     carries its maker's mark (`made_mark`, now handed to `give`), for Keen
 *     Edge, Balanced, Mail Maker, Plate Maker and Temper Bath;
 *   * a thing made one at a time out of marked parts keeps what they carried
 *     (`perform_craft`): a Keen Edge sword blade makes a Keen Edge sword
 *     whoever fits it. Four new families of mark are read where their rules
 *     are: `soak` in `piece_soak`, `aim` in `hit_chance`, `last` in the pour's
 *     wear and `mould_uses_left`, and `temper` by Quench;
 *   * the smelter (`perform_firing`): Reclaimer gives back more of a thing
 *     melted down, and better (`melt:share`, `melt:keep`, which `melt_lumps`
 *     and `melt_ql` now take); Clean Pour takes a mould's damage out of the
 *     pour (`pour:wear`); Glassblower and Sure Alloy needed only their rows;
 *   * Ingots: `pour_ingot` pours five lumps into a bar at the lumps' quality,
 *     and a bar counts as its lumps wherever the smelter, the anvil, a recipe
 *     or Improve takes lumps -- `unbar` breaks into as many bars as a job is
 *     short of, into the pack, and the rest of each comes back as lumps;
 *   * Forge Reach: `craft_reach` reads the go's perks (`pkx`) for smelter and
 *     anvil work (`forge_work`), and a refusal now has the go's perks too
 *     (`act_refusal`), so the stores it reaches into are the same for both;
 *   * Metal Polisher (`perform_item`, `improve:` and the material), Long
 *     Shift (`queue_capacity`, `jobs`), and Temper Bath's Quench, which adds
 *     the temper a thing carries to its quality once, at water.
 *
 * And two roundings brought to the browser's: melting down took a half to
 * the even lump, where `Math.round` takes it up, so a chain hauberk melted to
 * two lumps on the island and said three in the browser.
 *
 * The Smith's nodes go with its tree, and every Smith's fold is written again.
 */
set local lock_timeout = '3s';

/* A bar is this many lumps, as `INGOT_LUMPS` has it in the browser. */
create or replace function ingot_lumps() returns integer language sql immutable as $fn$ select 5 $fn$;

/* The metal a lump or an ingot is of. */
create or replace function metal_by_bar(p_def text)
 returns metal_def language sql stable as $fn$
  select m.* from metal_def m where m.lump = p_def or m.id || '_ingot' = p_def limit 1
$fn$;

/*
 * The maker's mark, with the Smith's four families beside the Carpenter's:
 * `soak` on what a piece of armour turns aside, `aim` on how often a weapon
 * lands, `last` on how many fillings a mould lasts, and `temper`, the quality
 * one quench adds.
 */
create or replace function made_mark(p_mul jsonb, p_def text)
 returns jsonb language sql immutable as $fn$
  select nullif(jsonb_strip_nulls(jsonb_build_object(
    'hold', p_mul->'fx'->('hold:' || p_def),
    'speed', p_mul->'fx'->('speed:' || p_def),
    'damage', p_mul->'fx'->('damage:' || p_def),
    'range', p_mul->'fx'->('range:' || p_def),
    'soak', p_mul->'fx'->('soak:' || p_def),
    'aim', p_mul->'fx'->('aim:' || p_def),
    'last', p_mul->'fx'->('last:' || p_def),
    'temper', p_mul->'fx'->('temper:' || p_def))), '{}'::jsonb)
$fn$;

/*
 * `give` with a maker's mark (a Smith's Keen Edge on a sword blade, which
 * stacks): the mark is part of the pile's key, so it goes on the pile with
 * the same mark or starts one. Every call without one is the old `give`.
 */
CREATE OR REPLACE FUNCTION public.give(p_world uuid, p_uid uuid, p_item text, p_n integer, p_ql double precision, p_extra text, p_rare text, p_maker text, p_cast text, p_mark jsonb)
 RETURNS bigint
 LANGUAGE plpgsql
AS $function$
declare found bigint; fresh item;
begin
  /*
   * Ask the one rule, then either add to the pile or start one.
   *
   * This used to carry its own idea of what shares a stack -- def, extra,
   * rare, maker, piece -- and the doors that *move* a row into a pack carried
   * none at all. Two rules and eight places with no rule is how a pack ends up
   * holding six separate piles of cotton seeds.
   *
   * There is one rule now, `stack_key`, and this asks it of the row it is
   * *about* to write rather than of one it has written. Writing first and
   * folding after would be a line shorter and is the wrong shape: an insert
   * and a delete where an update would do, two row versions instead of one on
   * the hottest table on the island, and an identity burnt every time a
   * harvest lands on a pile it already had. The suite noticed the last of
   * those within twelve lines.
   *
   * Two things follow from the shared rule and are worth saying out loud: a
   * dyed or blessed thing no longer folds into a plain one, which it did
   * before and should not have; and a harvest folds into the pile in the pack
   * rather than into a stack sitting inside a bag, which it also did before --
   * with no check that the bag had room for it.
   */
  if item_stackable(p_item) then
    -- The row as it would be written, so the key is the real key and not a
    -- hand-copied echo of it that can drift.
    fresh.def := p_item; fresh.extra := p_extra; fresh.rare := p_rare;
    fresh.maker := p_maker; fresh.piece := p_cast;
    -- And what its maker put into it: a marked pile is a pile of its own.
    fresh.mark := p_mark;
    fresh.locked := false; fresh.lit := false; fresh.issued := false;
    select i.id into found from item i
     where i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid
       and i.def = p_item and stack_key(i) = stack_key(fresh)
     order by i.id limit 1;
    if found is not null then
      -- Quality of a stack is the average of what is in it, by the unit.
      update item set ql = (ql * count + greatest(0, least(100, p_ql)) * p_n) / (count + p_n),
                      count = count + p_n
        where id = found;
      return found;
    end if;
  end if;
  insert into item (world_id, holder, holder_uid, def, ql, count, extra, rare, maker, piece, mark)
  values (p_world, 'player', p_uid, p_item, greatest(0, least(100, p_ql)), p_n, p_extra, p_rare, p_maker, p_cast, p_mark)
  returning id into found;
  return found;
end $function$;

create or replace function give(p_world uuid, p_uid uuid, p_item text, p_n integer, p_ql double precision,
                                p_extra text default null, p_rare text default null, p_maker text default null,
                                p_cast text default null)
 returns bigint language sql as $fn$
  select give(p_world, p_uid, p_item, p_n, p_ql, p_extra, p_rare, p_maker, p_cast, null::jsonb)
$fn$;

/*
 * Break into a stack of ingots for `p_need` lumps (a Smith's Ingots): as many
 * bars as that takes, into the pack as lumps at the bar's quality, and the
 * stack of lumps they land on is what comes back. A lump is handed back as it
 * is, so a job may call this on whatever it was pointed at.
 */
create or replace function unbar(p_world uuid, p_uid uuid, p_id bigint, p_need integer)
 returns item language plpgsql as $fn$
declare it item; m metal_def; k int; v_id bigint;
begin
  select * into it from item where world_id = p_world and id = p_id;
  if not found then return null; end if;
  m := metal_by_bar(it.def);
  if m.id is null or it.def = m.lump then return it; end if;
  k := least(it.count, greatest(1, ceil(p_need::numeric / ingot_lumps())::int));
  if not spend_stack(p_world, p_uid, it.id, k) then return null; end if;
  v_id := give(p_world, p_uid, m.lump, k * ingot_lumps(), it.ql, null, it.rare, it.maker);
  select * into it from item where id = v_id;
  return it;
end $fn$;

/* Break into as many bars at hand as a job is short of lumps of this metal, in the order a craft spends them. */
create or replace function break_bars(p_world uuid, p_uid uuid, p_lump text, p_short integer, p_prefer bigint default null)
 returns void language plpgsql as $fn$
declare r record; v_short int := p_short; k int; m metal_def;
begin
  if v_short <= 0 then return; end if;
  select * into m from metal_def where lump = p_lump;
  if m.id is null then return; end if;
  for r in
    select s.id, s.count from craft_stock(p_world, p_uid, p_prefer) s
     where s.def = m.id || '_ingot'
     order by (s.id = p_prefer) desc, s.draw
  loop
    exit when v_short <= 0;
    k := least(r.count, ceil(v_short::numeric / ingot_lumps())::int);
    perform unbar(p_world, p_uid, r.id, k * ingot_lumps());
    v_short := v_short - k * ingot_lumps();
  end loop;
end $fn$;

/*
 * Lumps of a metal at hand in bars: what its ingots count as. None for
 * anything that is not a lump, without looking at the stores at all, since
 * every craft asks this of every thing it takes.
 */
create or replace function bar_count(p_world uuid, p_uid uuid, p_lump text, p_chosen bigint default null)
 returns integer language plpgsql stable as $fn$
declare v_bar text;
begin
  select m.id || '_ingot' into v_bar from metal_def m where m.lump = p_lump;
  if v_bar is null then return 0; end if;
  return coalesce((select sum(s.count) from craft_stock(p_world, p_uid, p_chosen) s where s.def = v_bar), 0)::int * ingot_lumps();
end $fn$;

/* What a craft may take of a thing, not counting bars: the old `craft_count`. */
CREATE OR REPLACE FUNCTION public.craft_count_loose(p_world uuid, p_uid uuid, p_item text, p_mat text DEFAULT NULL::text, p_chosen bigint DEFAULT NULL::bigint)
 RETURNS integer
 LANGUAGE sql
 STABLE
AS $function$
  select coalesce(sum(s.count), 0)::int from craft_stock(p_world, p_uid, p_chosen) s
   where s.def = p_item and (p_mat is null or s.extra is not distinct from p_mat)
$function$;

/*
 * What a craft may take of a thing, and a lump's bars as the lumps they count
 * as (a Smith's Ingots) -- except where a material has been settled on, which
 * a lump never has.
 */
create or replace function craft_count(p_world uuid, p_uid uuid, p_item text, p_mat text default null, p_chosen bigint default null)
 returns integer language sql stable as $fn$
  select craft_count_loose(p_world, p_uid, p_item, p_mat, p_chosen)
       + case when p_mat is null then bar_count(p_world, p_uid, p_item, p_chosen) else 0 end
$fn$;

CREATE OR REPLACE FUNCTION public.craft_consume(p_world uuid, p_uid uuid, p_item text, p_n integer, p_prefer bigint DEFAULT NULL::bigint, p_mat text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
AS $function$
declare left_to_take int := p_n; r record; have int; take int; only_mat boolean;
begin
  only_mat := p_mat is not null and craft_count(p_world, p_uid, p_item, p_mat, p_prefer) >= p_n;
  if craft_count(p_world, p_uid, p_item, case when only_mat then p_mat end, p_prefer) < p_n then return false; end if;
  -- Bars broken into for what loose lumps are short of (a Smith's Ingots),
  -- into the pack, which is where a craft takes from first.
  if not only_mat and exists (select 1 from metal_def m where m.lump = p_item) then
    perform break_bars(p_world, p_uid, p_item, p_n - craft_count_loose(p_world, p_uid, p_item, null, p_prefer), p_prefer);
  end if;
  for r in
    select s.id from craft_stock(p_world, p_uid, p_prefer) s
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
end $function$;

/*
 * Work at a smelter or an anvil, as `FORGE_WORK` has it in the browser, with
 * every recipe made at the smelter: what a Smith's Forge Reach reaches further
 * for.
 */
create or replace function forge_work(p_action text)
 returns boolean language sql stable as $fn$
  select coalesce(p_action in ('smelt_ore', 'melt_down', 'cast_anvil', 'pour_mould', 'pour_ingot', 'fuel_smelter',
                               'smith', 'strike_coins')
      or exists (select 1 from recipe r where r.id = p_action and r.station = 'smelter'), false)
$fn$;

/*
 * How far a craft reaches into the stores round you: three tiles, and for work
 * at a smelter or an anvil as far as a Smith's Forge Reach says. The job and
 * the perks are the go's own (`pkx`), which the clock sets for a go and
 * `act_refusal` for a refusal, so that the two reach the same stores.
 */
create or replace function craft_reach()
 returns integer language sql stable as $fn$
  select case when forge_work(pkx_act()) then greatest(3, floor(pkx('reach:forge', 3))::int) else 3 end
$fn$;

CREATE OR REPLACE FUNCTION public.craft_stock(p_world uuid, p_uid uuid, p_chosen bigint DEFAULT NULL::bigint)
 RETURNS TABLE(id bigint, def text, count integer, extra text, ql real, carried boolean, draw bigint)
 LANGUAGE sql
 STABLE
AS $function$
  with me as (
    select p.x, p.y, floor(p.x)::int as tx, floor(p.y)::int as ty,
           coalesce(p.craft_from_stores, true) as stores,
           coalesce(p.craft_spare_rare, false) as spare,
           -- Asked once: three tiles, or further for a Smith's Forge Reach at the smelter or the anvil.
           craft_reach() as r
      from player p where p.world_id = p_world and p.uid = p_uid
  ),
  crates as materialized (
    select c.id, sqrt((crate_centre_x(c) - me.x) ^ 2 + (crate_centre_y(c) - me.y) ^ 2) as d
      from crate c, me
     where me.stores and c.world_id = p_world
       and c.x between me.tx - me.r and me.tx + me.r
       and c.y between me.ty - me.r and me.ty + me.r
       and crate_yours(p_world, p_uid, c.id)
       and not lock_shut(p_world, p_uid, c.lock, c.x, c.y)
  ),
  pieces as materialized (
    select pl.id, sqrt((pl.cx - me.x) ^ 2 + (pl.cy - me.y) ^ 2) as d
      from placed pl join furniture_def f on f.id = pl.sub, me
     where me.stores and pl.world_id = p_world and pl.kind = 'furniture'
       and pl.x between me.tx - me.r and me.tx + me.r
       and pl.y between me.ty - me.r and me.ty + me.r
       and furniture_holds(pl)
       and coalesce(f.trash, 0) = 0 and not f.stall
       -- Yours, or on a settlement of yours -- or a cart, a wagon or a boat,
       -- which is anybody's to load and to empty, and so anybody's to use.
       and (pl.made_by = p_uid or on_my_deed(p_world, p_uid, pl.x, pl.y) or f.cart or is_driveable(pl))
       and not lock_shut(p_world, p_uid, pl.lock, pl.x, pl.y)
  ),
  stock as (
    -- Loose in your hands.
    select i.id, i.def, i.count, i.extra, i.ql, i.rare, true as carried,
           0 as rank, 0::double precision as d, 0 as kind, 0::bigint as store
      from item i
     where i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid
       and not i.locked and i.deal is null
    union all
    -- In a bag you are carrying: `carried`, the lookup `in_the_bag` made.
    select i.id, i.def, i.count, i.extra, i.ql, i.rare, true, 1, 0, 0, b.id
      from item b join item i on i.inside = b.id and i.holder = 'bag'
     where b.world_id = p_world and b.holder = 'player' and b.holder_uid = p_uid
       and not i.locked and i.deal is null
    union all
    select i.id, i.def, i.count, i.extra, i.ql, i.rare, false, 2, c.d, 0, c.id::bigint
      from crates c join item i on i.world_id = p_world and i.holder = 'crate' and i.crate = c.id
     where not i.locked and i.deal is null and i.price is null and i.letter is null
    union all
    select i.id, i.def, i.count, i.extra, i.ql, i.rare, false, 2, pc.d, 1, pc.id
      from pieces pc join item i on i.world_id = p_world and i.holder = 'furniture' and i.placed = pc.id
     where not i.locked and i.deal is null and i.price is null and i.letter is null
  )
  select s.id, s.def, s.count, s.extra, s.ql, s.carried,
         row_number() over (order by s.rank, s.d, s.kind, s.store, s.id)
    from stock s
   where coalesce(s.rare, '') = ''
      or s.id is not distinct from p_chosen
      or not coalesce((select m.spare from me m), false)
$function$;

CREATE OR REPLACE FUNCTION public.act_refusal(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS text
 LANGUAGE plpgsql
AS $function$
declare why text; was_pk text; was_act text;
begin
  why := body_refusal(p_world, p_uid, p_action);
  if why is not null then return why; end if;
  -- A grave opens for whoever lies under it, and only to be emptied.
  why := grave_refusal(p_world, p_uid, p_action, p_target);
  if why is not null then return why; end if;
  /*
   * The go's perks, for the rules too deep to be handed the body (`pkx`), as
   * the clock sets them for a go: so a Smith's Forge Reach reaches the same
   * stores for the refusal as for the go. Put back as they were after.
   */
  was_pk := current_setting('wurm.pk', true);
  was_act := current_setting('wurm.pk_act', true);
  perform set_config('wurm.pk', coalesce((select pl.class_mul->'fx' from player pl
                                           where pl.world_id = p_world and pl.uid = p_uid), '{}'::jsonb)::text, true);
  perform set_config('wurm.pk_act', coalesce(p_action, ''), true);
  why := act_refusal_rules(p_world, p_uid, p_action, p_target);
  perform set_config('wurm.pk', coalesce(was_pk, ''), true);
  perform set_config('wurm.pk_act', coalesce(was_act, ''), true);
  return why;
end $function$;

/*
 * Lumps that come back from a thing melted down, with `p_share` of its metal
 * (more for a Smith's Reclaimer), and a half taken up as `Math.round` takes it.
 */
create or replace function melt_lumps(it item, p_count integer, p_share double precision)
 returns integer language sql stable as $fn$
  select greatest(1, floor(coalesce(item_metal(it), 0) * p_count * p_share + 0.5)::int)
$fn$;
create or replace function melt_lumps(it item, p_count integer)
 returns integer language sql stable as $fn$ select melt_lumps(it, p_count, melt_share()) $fn$;
create or replace function melt_lumps(p_item text, p_count integer)
 returns integer language sql stable as $fn$
  select greatest(1, floor(coalesce((select content from melt_def where item = p_item), 0) * p_count * melt_share() + 0.5)::int)
$fn$;

/* The quality of what comes back, `p_keep` of it (more for a Smith's Reclaimer) less the damage. */
create or replace function melt_ql(p_ql double precision, p_dmg double precision, p_keep double precision)
 returns double precision language sql immutable as $fn$
  select greatest(1, p_ql * p_keep * (1 - p_dmg / 100))
$fn$;
create or replace function melt_ql(p_ql double precision, p_dmg double precision)
 returns double precision language sql immutable as $fn$ select melt_ql(p_ql, p_dmg, melt_keep()) $fn$;

/* Fillings a mould has left, for a mould marked to last `p_last` times as many (a Smith's Hard Sand). */
create or replace function mould_uses_left(p_ql double precision, p_dmg double precision, p_last double precision)
 returns integer language sql immutable as $fn$
  select greatest(0, ceil((100 - p_dmg) / (mould_wear(p_ql) / p_last)))::int
$fn$;
create or replace function mould_uses_left(p_ql double precision, p_dmg double precision)
 returns integer language sql immutable as $fn$ select mould_uses_left(p_ql, p_dmg, 1) $fn$;

/* And long shifts: more jobs held in the head for a Smith's Long Shift. */
create or replace function queue_capacity(p_world uuid, p_uid uuid)
 returns integer language sql stable as $fn$
  select queue_capacity(skill_of(p_world, p_uid, 'mind_logic')) + floor(pk(p_world, p_uid, 'jobs', 0))::int
$fn$;

CREATE OR REPLACE FUNCTION public.piece_soak(it item, p_skill double precision)
 RETURNS double precision
 LANGUAGE sql
 STABLE
AS $function$
  select least(0.92, c.soak * mat_soak(it.extra) * rarity_boost(it.rare)
    * (0.55 + it.ql / 220) * greatest(0.25, 1 - it.dmg / 130) * (1 + p_skill / 400)
    -- And what its maker put into it (a Smith's Mail Maker or Plate Maker), under the same ceiling.
    * mark_of(it.mark, 'soak'))
  from armour_def a join armour_class_def c on c.id = a.cls where a.id = it.def
$function$;

CREATE OR REPLACE FUNCTION public.hit_chance(p_world uuid, p_uid uuid, p_kind text, p_aim double precision)
 RETURNS double precision
 LANGUAGE sql
 STABLE
AS $function$
  /*
   * And the trade, on the weapon in hand and no other.
   *
   * A multiplier rather than points added, so it folds like every other
   * channel -- but it goes *inside* the ceiling, because this is a
   * probability and 0.96 is where it stops however good you are. That is why
   * `aim` is the gentlest of the fighting channels: most of a tenth on a
   * chance that already sits at nine tenths is spent against the cap.
   */
  select least(0.96, (0.45 + skill_of(p_world, p_uid, p_kind) / 220
    + skill_of(p_world, p_uid, 'fighting') / 300
    + skill_of(p_world, p_uid, 'body_control') / 500)
    * class_mul(p_world, p_uid, 'aim', p_kind)
    -- And what the weapon's maker put into it (a Smith's Balanced), inside the ceiling too.
    * coalesce(p_aim, 1))
$function$;

create or replace function hit_chance(p_world uuid, p_uid uuid, p_kind text)
 returns double precision language sql stable as $fn$ select hit_chance(p_world, p_uid, p_kind, 1) $fn$;

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
    v_share := butcher_yield(skill_of(p_world, p_uid, 'butchering'), knife_ql);
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

CREATE OR REPLACE FUNCTION public.smith_lump(p_world uuid, p_uid uuid, p_uid_item bigint)
 RETURNS item
 LANGUAGE sql
 STABLE
AS $function$
  -- At hand: the pack, a bag, or a store within reach, in the order a craft
  -- spends them, and nothing put by.
  select i.* from craft_stock(p_world, p_uid, p_uid_item) s join item i on i.id = s.id
  -- Lumps, and ingots, which count as their lumps (a Smith's Ingots).
  where exists (select 1 from metal_def m where m.lump = s.def or m.id || '_ingot' = s.def)
  order by (s.id = p_uid_item) desc, s.draw
  limit 1
$function$;

CREATE OR REPLACE FUNCTION public.forge_refusal(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
AS $function$
declare p placed; it item; v_lump item; v_cast item;
begin
  if p_action in ('fuel_oven', 'light_oven', 'put_out_oven', 'take_ashes_oven') then
    select * into p from placed where world_id = p_world and id = (p_target->>'id')::bigint;
    if not found or not is_oven(p) then return 'That is not an oven.'; end if;
    if not near_piece(p_world, p_uid, p) then return 'Stand next to the oven.'; end if;
    if p_action = 'fuel_oven' then
      select i.* into it from craft_stock(p_world, p_uid, target_item(p_target)) s join item i on i.id = s.id
        where fuel_value(s.def) is not null
          and (target_item(p_target) is null or s.id = target_item(p_target))
        order by s.draw limit 1;
      if not found then return 'An oven takes what a fire takes: ' || fuel_said() || '.'; end if;
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
    select * into it from item where world_id = p_world and id = target_item(p_target)
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
      and (target_item(p_target) is null or id = target_item(p_target))
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
  if p_action = 'strike_coins' then
    -- Coins: a die in the pack, and a lump of a metal that coins, in the
    -- words the browser uses.
    if pack_count(p_world, p_uid, 'coin_die') < 1 then return 'You need a coin die.'; end if;
    v_lump := smith_lump(p_world, p_uid, target_item(p_target));
    if v_lump.id is null then return 'You have no metal to strike.'; end if;
    if not coalesce((metal_by_bar(v_lump.def)).coins, false) then return 'Coins are struck from silver or gold.'; end if;
    return null;
  end if;
  -- Smithing: a casting poured at the smelter, in the words the browser uses.
  v_cast := smith_casting(p_world, p_uid, target_item(p_target));
  if v_cast.id is null then
    return case when target_item(p_target) is not null then 'Choose a casting.'
                else 'Pour a mould at the smelter first.' end;
  end if;
  if not exists (select 1 from mould_def where makes = v_cast.piece) then return 'Choose a casting.'; end if;
  return null;
end $function$;

CREATE OR REPLACE FUNCTION public.perform_forge(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare p placed; it item; v_mould item; d mould_def; v_lump item; m metal_def; v_cast item;
        v_per double precision; v_room double precision; v_fits int; v_whole int;
        v_ql double precision; v_mould_ql double precision; v_hard double precision;
        v_rare text; v_made bigint; v_broke boolean; v_sz int[]; v_sx int; v_sy int; v_left double precision;
        v_count int; v_kept boolean;
begin
  if p_action in ('fuel_oven', 'light_oven', 'put_out_oven', 'take_ashes_oven') then
    perform placed_settle((p_target->>'id')::bigint);
    select * into p from placed where world_id = p_world and id = (p_target->>'id')::bigint;
    if not found then return; end if;

    if p_action = 'fuel_oven' then
      select i.* into it from craft_stock(p_world, p_uid, target_item(p_target)) s join item i on i.id = s.id
        where fuel_value(s.def) is not null
          and (target_item(p_target) is null or s.id = target_item(p_target))
        order by s.draw limit 1;
      if not found then return; end if;
      v_per := fuel_value(it.def);
      v_room := greatest(0, hearth_capacity(p) - p.fuel);
      v_fits := greatest(1, least(least(coalesce((p_target->>'count')::int, 1), it.count),
                                  ceil(v_room / v_per)::int));
      if not spend_stack(p_world, p_uid, it.id, v_fits) then return; end if;
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
    perform lantern_settle(target_item(p_target));
    select * into it from item where world_id = p_world and id = target_item(p_target);
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
      and (target_item(p_target) is null or id = target_item(p_target))
      order by id limit 1;
    if not found then return; end if;
    v_sx := least(subtiles() - anvil_subtiles(), greatest(0, coalesce((p_target->>'sx')::int, 0)));
    v_sy := least(subtiles() - anvil_subtiles(), greatest(0, coalesce((p_target->>'sy')::int, 0)));
    -- An anvil's metal rides in `sub`, and its rarity now rides beside it.
    insert into placed (world_id, kind, sub, x, y, sx, sy, cx, cy, ql, made_by, rare)
    values (p_world, 'anvil', coalesce(it.extra, 'copper'),
            (p_target->>'x')::int, (p_target->>'y')::int, v_sx, v_sy,
            (p_target->>'x')::int + (v_sx + 1.0) / subtiles(),
            (p_target->>'y')::int + (v_sy + 1.0) / subtiles(), it.ql, p_uid, it.rare)
    returning * into p;
    delete from item where id = it.id;
    perform tell(p_world, p_uid, 'You set the ' || lower(anvil_name(p))
      || ' down. Bring a casting to it.', 'event');
    perform land_announce(p_world, p.x, p.y);
    return;
  end if;

  select * into p from placed where world_id = p_world and id = (p_target->>'id')::bigint;
  if not found then return; end if;

  if p_action = 'pick_up_anvil' then
    perform give(p_world, p_uid, 'anvil', 1, p.ql, p.sub, p.rare);
    perform tell(p_world, p_uid, 'You heave the ' || lower(anvil_name(p))
      || ' up onto your shoulder.', 'event');
    delete from placed where id = p.id;
    perform land_announce(p_world, p.x, p.y);
    return;
  end if;

  -- Smithing: the mould, the metal, the anvil and the hands, in that order.
  if p_action = 'strike_coins' then
    -- The die wears with every strike, good or bad, and no die can be mended.
    select * into v_mould from item where world_id = p_world and holder = 'player' and holder_uid = p_uid
      and def = 'coin_die' order by tool_worth(ql, dmg, extra, rare, bless) desc limit 1;
    v_lump := smith_lump(p_world, p_uid, target_item(p_target));
    m := metal_by_bar(v_lump.def);
    if v_mould.id is null or v_lump.id is null or m.id is null or not m.coins then return; end if;
    -- A bar is broken into for the lump a strike takes (a Smith's Ingots).
    v_lump := unbar(p_world, p_uid, v_lump.id, 1);
    if v_lump.id is null or not spend_stack(p_world, p_uid, v_lump.id, 1) then return; end if;
    v_mould_ql := greatest(1, v_mould.ql - v_mould.dmg / 2);
    v_broke := v_mould.dmg + die_wear() >= 100;
    if v_broke then
      delete from item where id = v_mould.id;
    else
      update item set dmg = least(100, v_mould.dmg + die_wear()) where id = v_mould.id;
    end if;
    v_hard := coin_difficulty() + (mat_of(v_lump.extra)).difficulty;
    -- A Smith's Sure Hammer fails half as often (`fail:` and the job).
    if not perk_pass(skill_check(skill_of(p_world, p_uid, 'blacksmithing'), v_hard, anvil_ql(p),
                                 mind_ease(p_world, p_uid)), pk(p_world, p_uid, 'fail:' || p_action, 1)) then
      perform skill_raise(p_world, p_uid, 'blacksmithing', try_gain(false, smith_gain()));
      perform tell(p_world, p_uid, 'The blanks come out smeared and you throw the metal back.'
        || case when v_broke then ' The die is worn through.' else '' end, 'event');
      return;
    end if;
    v_ql := smith_ql(p_world, p_uid, 'blacksmithing', v_mould_ql, v_lump.ql, anvil_ql(p));
    perform skill_raise(p_world, p_uid, 'blacksmithing', try_gain(true, smith_gain()));
    v_rare := rarity_roll();
    v_made := give(p_world, p_uid, 'coin', coins_per_lump()::int, v_ql, m.name, v_rare, maker_mark(p_world, p_uid, v_rare));
    perform journal_made(p_world, p_uid, 'coin', v_ql, coins_per_lump()::int, v_rare);
    perform journal_note(p_world, p_uid, 'minted');
    if v_rare is not null then
      perform journal_note(p_world, p_uid, v_rare);
      perform tell(p_world, p_uid, rarity_word(v_rare), 'skill');
    end if;
    perform tell(p_world, p_uid, 'You strike ' || coins_per_lump()::int || ' ' || lower(m.name)
      || ' coins on the ' || lower(anvil_name(p)) || '. (QL ' || to_char(v_ql, 'FM990.0') || ')'
      || case when v_broke then ' The die is worn through and done.'
              else ' The die has ' || ceil((100 - (v_mould.dmg + die_wear())) / die_wear())::int || ' strikes left.' end, 'event');
    return;
  end if;

  -- Smithing: a casting poured at the smelter, beaten true on the anvil.
  v_cast := smith_casting(p_world, p_uid, target_item(p_target));
  select * into d from mould_def where makes = v_cast.piece;
  m := metal_by_name(v_cast.extra);
  if v_cast.id is null or d.id is null or m.id is null then return; end if;

  -- The deeper the seam it came out of, the harder it is to beat into shape.
  -- Rolled before the casting is spent, so that a Smith's Second Heat has a
  -- casting to keep; and a Smith's Sure Hammer fails half as often.
  v_hard := d.difficulty + (mat_of(v_cast.extra)).difficulty;
  if not perk_pass(skill_check(skill_of(p_world, p_uid, d.skill), v_hard, anvil_ql(p),
                               mind_ease(p_world, p_uid)), pk(p_world, p_uid, 'fail:' || p_action, 1)) then
    v_kept := random() < pk(p_world, p_uid, 'spare:' || p_action, 0);
    if not v_kept and not spend_stack(p_world, p_uid, v_cast.id, 1) then return; end if;
    perform skill_raise(p_world, p_uid, d.skill, try_gain(false, smith_gain()));
    perform tell(p_world, p_uid, 'The '
      || lower((select name from item_def where id = d.makes))
      || ' comes out misshapen and '
      || case when v_kept then 'goes back into the fire: the casting is kept.' else 'you throw the metal back.' end, 'event');
    return;
  end if;
  if not spend_stack(p_world, p_uid, v_cast.id, 1) then return; end if;

  -- The casting carries the mould and the metal it was poured from, so it stands for both.
  -- Better for a Smith's Toolsmith on a tool's head or blade (`ql:` and the piece).
  v_ql := least(100, smith_ql(p_world, p_uid, d.skill, v_cast.ql, v_cast.ql, anvil_ql(p))
                     * pk(p_world, p_uid, 'ql:' || d.makes, 1));
  perform skill_raise(p_world, p_uid, d.skill, try_gain(true, smith_gain()));
  v_rare := rarity_roll();
  -- More to a filling for a Smith's Nail Maker (`count:` and the piece).
  v_count := floor(pk(p_world, p_uid, 'count:' || d.makes, d.per))::int;
  -- And what the smith's perks put into it (Keen Edge, Balanced, Mail Maker,
  -- Plate Maker, Temper Bath), which goes with a head into what it is fitted to.
  v_made := give(p_world, p_uid, d.makes, v_count, v_ql, m.name, v_rare, maker_mark(p_world, p_uid, v_rare), null,
                 made_mark((select pl.class_mul from player pl where pl.world_id = p_world and pl.uid = p_uid), d.makes));
  perform journal_made(p_world, p_uid, d.makes, v_ql, v_count, v_rare);
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
    || case when v_count > 1 then v_count || ' ' else 'a ' end
    || lower(m.name) || ' '
    || case when v_count > 1 and right(lower((select name from item_def where id = d.makes)), 1) <> 's'
            then lower((select name from item_def where id = d.makes)) || 's'
            else lower((select name from item_def where id = d.makes)) end
    || ' on the ' || lower(anvil_name(p)) || '. (QL ' || to_char(v_ql, 'FM990.0') || ')', 'event');
  -- And what the go taught, said: it was raised and never told, which read as nothing learned.
end $function$;

CREATE OR REPLACE FUNCTION public.firing_action(p_action text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select p_action in ('smelt_ore', 'melt_down', 'cast_anvil', 'pour_mould', 'pour_ingot', 'smelter_take_all',
                      'load_kiln', 'kiln_take_all')
$function$;

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
      perform give(p_world, p_uid, v_one->>'def', (v_one->>'count')::int,
        (v_one->>'ql')::double precision, v_one->>'extra', null, null, v_one->>'piece');
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
      v_jobs := v_jobs || jsonb_build_object('makes', v_makes, 'left', v_secs, 'total', v_secs, 'ql', v_ql);
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

CREATE OR REPLACE FUNCTION public.firing_refusal(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS text
 LANGUAGE plpgsql
AS $function$
declare v_p placed; v_it item; v_mould item; v_metal metal_def; v_need int; d mould_def;
begin
  perform furnace_settle(p_world, nullif(p_target->>'id', '')::bigint);
  v_p := target_placed(p_world, p_target);
  if v_p.id is null then return 'It is gone.'; end if;
  if not placed_in_reach(p_world, p_uid, v_p.id, 2.6) then
    return 'Stand next to the ' || v_p.kind || '.';
  end if;

  if p_action in ('smelter_take_all', 'kiln_take_all') then
    if jsonb_array_length(furnace_output(v_p)) = 0 then
      return case when p_action = 'kiln_take_all' then 'Nothing is fired yet.' else 'Nothing is finished yet.' end;
    end if;
    return null;
  end if;

  -- What goes in is at hand: in the pack, a bag, or a store within reach.
  select * into v_it from item where id = target_item(p_target)
    and world_id = p_world and at_hand(p_world, p_uid, id);

  if p_action = 'smelt_ore' then
    if not found or (metal_by_ore(v_it.def)).id is null then return 'Smelters take ore.'; end if;
    -- A charge is twenty kilograms of ore, which is `ore_per_lump` of them.
    if v_it.count < ore_per_lump() then
      return 'A charge is ' || ore_per_lump()::int || ' ore; you have ' || v_it.count || '.';
    end if;
    if jsonb_array_length(furnace_jobs(v_p)) >= furnace_capacity(v_p) then
      return 'The furnace is charged as full as it will go.';
    end if;
    return null;

  elsif p_action = 'melt_down' then
    -- Scrap goes back into the fire: anything cast from metal, or hafted to a
    -- cast head, in the words the browser uses.
    if not found then return 'Choose something to melt down.'; end if;
    if v_it.locked then return 'It is put by. Unlock it first.'; end if;
    v_metal := metal_by_name(v_it.extra);
    if v_metal.id is null or item_metal(v_it) is null then
      return 'That is not made of metal the fire would give back.';
    end if;
    if jsonb_array_length(furnace_jobs(v_p))
       + melt_lumps(v_it, least(greatest(1, coalesce((p_target->>'count')::int, 1)), v_it.count),
                    pk(p_world, p_uid, 'melt:share', melt_share()))
       > furnace_capacity(v_p) then
      return 'The furnace is charged as full as it will go.';
    end if;
    return null;

  elsif p_action = 'load_kiln' then
    if not found then
      select i.* into v_it from craft_stock(p_world, p_uid) s join item i on i.id = s.id
        where exists (select 1 from pottery_def where unfired = s.def) order by s.draw limit 1;
    end if;
    if not found or not exists (select 1 from pottery_def where unfired = v_it.def) then
      return 'A kiln takes unfired clay.';
    end if;
    if jsonb_array_length(furnace_jobs(v_p)) >= furnace_capacity(v_p) then
      return 'The kiln is packed as full as it will go.';
    end if;
    return null;

  elsif p_action = 'pour_mould' then
    -- Every mould but the anvil's is filled here and cools into a casting for
    -- the anvil, in the words the browser uses.
    select * into v_mould from item where world_id = p_world and id = target_mould(p_target)
      and holder = 'player' and holder_uid = p_uid;
    if v_mould.id is null then return 'Choose a mould.'; end if;
    select * into d from mould_def where id = v_mould.def;
    if d.id is null then return 'Choose a mould.'; end if;
    if d.makes = 'anvil' then return 'An anvil is cast whole: pour it with Cast an anvil.'; end if;
    v_metal := metal_by_bar(v_it.def);
    if v_it.id is null or v_metal.id is null then return 'You have no metal to pour.'; end if;
    v_need := mould_lumps(d.id, v_metal.id);
    -- An ingot counts as its lumps (a Smith's Ingots).
    if v_it.count * (case when v_it.def = v_metal.lump then 1 else ingot_lumps() end) < v_need then
      return 'That takes ' || v_need || ' lumps.';
    end if;
    if jsonb_array_length(furnace_jobs(v_p)) >= furnace_capacity(v_p) then
      return 'The furnace is charged as full as it will go.';
    end if;
    return null;

  elsif p_action = 'cast_anvil' then
    if pack_count(p_world, p_uid, 'anvil_mould') <= 0 then return 'You need an anvil mould.'; end if;
    v_metal := metal_by_bar(v_it.def);
    if not found or v_metal.id is null then return 'Choose the metal to pour.'; end if;
    v_need := mould_lumps('anvil_mould', v_metal.id);
    if v_it.count * (case when v_it.def = v_metal.lump then 1 else ingot_lumps() end) < v_need then
      return 'An anvil takes ' || v_need || ' lumps of ' || lower(v_metal.name) || '.';
    end if;
    return null;

  elsif p_action = 'pour_ingot' then
    -- In the words the browser uses.
    if pk(p_world, p_uid, 'ingot', 0) <= 0 then return 'That wants a Smith who has learned to pour ingots.'; end if;
    v_metal := metal_by_lump(v_it.def);
    if not found or v_metal.id is null then return 'Choose the metal to pour.'; end if;
    if v_it.count < ingot_lumps() then
      return 'An ingot takes ' || ingot_lumps() || ' lumps; you have ' || v_it.count || '.';
    end if;
    return null;
  end if;
  return null;
end $function$;

CREATE OR REPLACE FUNCTION public.item_action(p_action text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select p_action in ('improve_item', 'repair_item', 'eat', 'drink', 'drink_skin', 'quench_item')
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
        + coalesce((select food from item_def where id = v_it.def), 0) * (0.7 + v_it.ql / 200))))
      where world_id = p_world and uid = p_uid;
    -- A dish favours a trade, and having eaten it you are better at that
    -- trade for a while.
    v_favour := grant_boon(p_world, p_uid, v_it.def, v_it.ql);
    v_full := nourish(p_world, p_uid, v_it.def, v_it.ql);
    perform tell(p_world, p_uid, 'You eat the ' || v_name || '.'
      || coalesce(' ' || v_favour, '') || coalesce(' ' || v_full, ''), 'event');

  elsif p_action = 'drink_skin' then
    update item set charges = coalesce(charges, 1) - 1 where id = v_it.id;
    update player set stats = jsonb_set(stats, '{thirst}', to_jsonb(least(1,
        coalesce((v_p.stats->>'thirst')::double precision, 1)
        + coalesce((select drink from item_def where id = v_it.def), 0))))
      where world_id = p_world and uid = p_uid;
    -- Milk and anything brewed favour a trade the way a cooked dish does.
    v_favour := grant_boon(p_world, p_uid, v_it.def, v_it.ql);
    v_full := nourish(p_world, p_uid, v_it.def, v_it.ql);
    perform tell(p_world, p_uid, 'You take a drink from the ' || v_name || '.'
      || coalesce(' ' || v_favour, '') || coalesce(' ' || v_full, ''), 'event');

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

CREATE OR REPLACE FUNCTION public.perform_craft(p_world uuid, p_uid uuid, p_recipe text, p_target jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare r recipe; i record; v_n int; prefer bigint; mat text; hard double precision; tq double precision;
        s double precision; made_ql double precision; rare text; total double precision := 0;
        v_made bigint; weight double precision := 0; one double precision; share double precision;
        only_mat boolean; was text; v_base int; spared boolean := false; v_mark jsonb;
        v_parts jsonb := '{}'::jsonb; v_part jsonb;
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
               and exists (select 1 from mould_def md where md.makes = ri.item) order by ri.ord loop
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
  for i in select * from recipe_input where recipe = p_recipe order by ord loop
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
  -- A Carpenter's Master Joiner: the first step of rarity at better odds on the joinery (`rare:` and the recipe).
  rare := perk_rare(pk(p_world, p_uid, 'rare:' || p_recipe, (select d.odds from rarity_def d order by d.ord limit 1)));
  -- More, the go a bauble on the trade comes up in the altar of the settlement you work on.
  -- A Mason's Three from a Shard and Good Mix: more of it at a go (`count:` and what it makes).
  v_base := pk(p_world, p_uid, 'count:' || r.result, r.count)::int;
  v_n := bauble_yield(p_world, p_uid, r.result, v_base);
  v_made := give(p_world, p_uid, r.result, v_n, made_ql, coalesce(r.extra, mat), rare, maker_mark(p_world, p_uid, rare));
  -- What the maker's perks put into it, which stays with it whoever has it
  -- after (a Carpenter's Deep Drawers, Keel Layer, True Bow). Only on a thing
  -- made one at a time, which is a row of its own.
  if not item_stackable(r.result) then
    -- Over what its parts carried (a Smith's Keen Edge), the maker's own (a Smith's Temper Bath).
    v_mark := nullif(v_parts || coalesce(made_mark((select pl.class_mul from player pl
                                                     where pl.world_id = p_world and pl.uid = p_uid), r.result), '{}'::jsonb),
                     '{}'::jsonb);
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
    perform give(p_world, p_uid, i.item, i.count, 20);
  end loop;

  perform skill_raise(p_world, p_uid, r.skill, 1);
  -- Working a thing out with your hands is what sharpens the head.
  perform skill_raise(p_world, p_uid, 'mind_logic', try_gain(true, craft_head()));
  perform tell(p_world, p_uid, count_said(r.done, r.count, v_base) || ' (' || case when mat is not null then lower(mat) || ', ' else '' end
    || 'QL ' || to_char(made_ql, 'FM990.0') || ')', 'event');
end $function$;

CREATE OR REPLACE FUNCTION public.mat_of_item(p_def text, p_extra text)
 RETURNS material_def
 LANGUAGE sql
 STABLE
AS $function$
  select m.* from material_def m
   where m.id = coalesce(
     (select n.id from material_def n where n.id = lower(coalesce(p_extra, ''))),
     -- A lump says its metal in its name, and so does an ingot (a Smith's Ingots).
     (select d.id from metal_def d where d.lump = p_def or d.id || '_ingot' = p_def))
$function$;


/*
 * The Smith's tree, cleared, as the four before it were: its nine nodes left
 * `class_node` with the rulebook that brought its perks, whatever of them
 * anybody had taken goes, and every Smith's fold is written again.
 */
delete from player_node where node ~ '^smith_[0-9]_[0-9]$';
do $$
declare r record;
begin
  for r in select world_id, uid from player where craft_class = 'smith' loop
    perform class_fold(r.world_id, r.uid);
  end loop;
end $$;

revoke all on function ingot_lumps() from public, anon, authenticated;
revoke all on function metal_by_bar(text) from public, anon, authenticated;
revoke all on function give(uuid, uuid, text, integer, double precision, text, text, text, text, jsonb) from public, anon, authenticated;
revoke all on function unbar(uuid, uuid, bigint, integer) from public, anon, authenticated;
revoke all on function break_bars(uuid, uuid, text, integer, bigint) from public, anon, authenticated;
revoke all on function bar_count(uuid, uuid, text, bigint) from public, anon, authenticated;
revoke all on function craft_count_loose(uuid, uuid, text, text, bigint) from public, anon, authenticated;
revoke all on function forge_work(text) from public, anon, authenticated;
revoke all on function melt_lumps(item, integer, double precision) from public, anon, authenticated;
revoke all on function melt_ql(double precision, double precision, double precision) from public, anon, authenticated;
revoke all on function mould_uses_left(double precision, double precision, double precision) from public, anon, authenticated;
revoke all on function hit_chance(uuid, uuid, text, double precision) from public, anon, authenticated;
select private.lock_doors();
