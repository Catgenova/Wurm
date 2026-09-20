-- One pile and not six, ash in the bin, and a mola that knows what a bin is for
--
-- Three things, reported together off one screenshot of a pack: 1,996 things,
-- three and a half tonnes, too heavy to walk -- and in it, six separate piles
-- of cotton seeds at 22.4, 37.4, 35.0, 45.6, 63.1 and 47.3.
--
-- ## Six piles of cotton seeds
--
-- Asked: "seeds and food should be combining and averaging ql, not making
-- constant new stacks."
--
-- They should, and `give` has always done exactly that -- it is what puts a
-- harvest, a catch, a forage or a finished piece in your hands, and it folds
-- into a matching stack at the average quality. Nothing that *makes* a thing
-- was at fault.
--
-- The doors that *move* a thing were. Picking something up off the ground,
-- taking all from a crate, emptying a cupboard, clearing a trap, buying off a
-- stall, collecting the post -- eight statements, in six functions, every one
-- of them some flavour of
--
--     update item set holder = 'player', holder_uid = ... where id = ...
--
-- which reparents the row and stops. The row keeps its own identity and its
-- own quality and lands in the pack beside the pile it should have joined. A
-- worker fills a crate a load at a time, so a crate of seeds is a dozen rows;
-- take all, and the pack gains a dozen piles. Six was a quiet afternoon.
--
-- So there is one rule now and everything asks it:
--
--     stack_key(i item) -> jsonb
--
-- def, which bag it is in, extra, rarity, dye, blessing, maker, piece, issued,
-- charges, keyed -- everything that shows in the name or changes what the
-- thing is, because a stack holds one of each. Null for a locked thing and for
-- a lit one: locking is how somebody says *this one, not the next one the game
-- reaches for*, and folding it into a pile would throw that away the moment it
-- was set. What is left over is quality and damage, and those average by the
-- unit.
--
-- It is jsonb rather than a string because jsonb nulls compare equal under `=`
-- and group together under `group by` -- which is the `is not distinct from`
-- this wants, eleven times over, for free -- and because a jsonb array of the
-- row's own columns is immutable and free of sublinks, so it folds into
-- whatever query asks it rather than costing a call per row. That lesson is
-- three migrations old.
--
-- Two entry points, one rule: `pack_fold_one` for a single arrival, which
-- takes the *oldest* matching stack so a thing goes back on the pile it came
-- off; `pack_fold` for the doors that move a handful of rows in one statement,
-- one group-by over the pack. `give` is now an insert and a fold, so it has
-- stopped carrying a fourth-hand copy of the rule.
--
-- Two changes fall out of that and are worth saying plainly rather than
-- leaving to be discovered. A dyed or blessed thing no longer folds into a
-- plain one -- `give` matched on neither, so a blue stack and a white stack
-- were one stack at whichever colour the older row happened to be. And a
-- harvest now folds into the pile in the pack rather than into a stack sitting
-- inside a bag; `give` used to reach into bags with no check that the bag had
-- room, which is a second bug of its own.
--
-- A rot clock takes the earlier of the two. A stack goes off when its oldest
-- part would, and freshness is not something to launder by tipping a new
-- harvest onto an old one.
--
-- And because fixing the doors does nothing about what they have already done,
-- the end of this file walks every pack on every island once through the same
-- rule. Nobody's load changes by a gram -- a stack of four and a stack of
-- three become a stack of seven at the average of the two -- only the number
-- of rows goes down.
--
-- ## Ash is a raw material
--
-- Asked: "count Ash as a raw material." It is: raked out of a fire, and
-- nothing a bench has touched, which is the whole of the test. `item_def.raw`
-- comes across from `src/game/items.ts` with the rest of the rulebook, so the
-- word is added there and arrives here in the definitions beside this. A raw
-- material bin will take it now, which matters because ash is the one thing a
-- furnace produces by the cartload and it had nowhere bulk to go.
--
-- ## And a mola that knows what a bin is for
--
-- Asked: "molas should prioritize storing into raw material bins." `worker_store`
-- offered every crate and every piece of furniture on the deed and sorted them
-- by distance, with the settlement's own crate first. A bin holds four hundred
-- where a crate holds a fraction of that and it refuses anything a bench has
-- touched -- it is built for precisely what a worker brings home by the
-- cartload -- and it was competing for the job on distance alone. Worse: a
-- worker that filled the deed crate with ore left nowhere for the things only
-- a crate will hold.
--
-- A raw load now goes to the nearest raw material bin with room, and failing a
-- bin, to exactly where it went before. Nothing else moves, and a load that is
-- not raw would be refused by a bin anyway.
--
-- `sameStack`, `storeFor` and the `raw` on a bin are the same three rules on
-- the browser's side; the suite asks the two to agree rather than trusting
-- that they do.



create or replace function item_stackable(p_def text) returns boolean
  language sql stable as $fn$ select coalesce(stackable, false) from item_def where id = p_def $fn$;

/*
 * What a thing has to have in common with another to share a stack with it.
 *
 * Everything that shows in the name or changes what the thing *is*, because a
 * stack holds one of each: one quality, one damage, one maker's mark, one
 * colour. What is left over -- quality and damage -- averages by the unit.
 *
 * `null` means it stacks with nothing at all. A locked thing is locked
 * precisely so the game stops reaching for it, and folding it into a pile
 * would throw that away the moment it was set; a lit thing is burning.
 *
 * Built as jsonb rather than a string because jsonb nulls compare equal under
 * `=` and group together under `group by`, which is the `is not distinct from`
 * this wants, eleven times over, for free. Immutable and free of sublinks, so
 * it folds into whatever query asks it.
 *
 * `sameStack` in src/game/items.ts is this sentence in TypeScript. The suite
 * asks the two to agree.
 */
create or replace function stack_key(i item) returns jsonb
  language sql immutable as $fn$
  select case when i.locked or i.lit then null
              else jsonb_build_array(i.def, i.inside, i.extra, i.rare, i.dye, i.bless,
                                     i.maker, i.piece, i.issued, i.charges, i.keyed) end
$fn$;

/*
 * Fold one newly arrived thing into the stack it belongs to, if there is one.
 *
 * The oldest matching stack wins, so a thing goes back on the pile it came
 * off rather than starting a rival one. Quality and damage average by the
 * unit; a rot clock takes the earlier of the two, because a stack goes off
 * when its oldest part would and freshness is not something you can launder
 * by tipping a new harvest onto an old one.
 */
create or replace function pack_fold_one(p_id bigint) returns bigint
  language plpgsql as $fn$
declare v_it item; v_into item; v_units int;
begin
  select * into v_it from item where id = p_id;
  if not found or v_it.holder <> 'player' or v_it.holder_uid is null then return p_id; end if;
  if stack_key(v_it) is null or not item_stackable(v_it.def) then return p_id; end if;
  select * into v_into from item o
   where o.world_id = v_it.world_id and o.holder = 'player' and o.holder_uid = v_it.holder_uid
     and o.id <> v_it.id and o.def = v_it.def and stack_key(o) = stack_key(v_it)
   order by o.id limit 1;
  if not found then return p_id; end if;
  v_units := v_into.count + v_it.count;
  update item set
      ql = least(100, greatest(0, (v_into.ql::numeric * v_into.count + v_it.ql::numeric * v_it.count) / v_units))::real,
      dmg = greatest(0, (v_into.dmg::numeric * v_into.count + v_it.dmg::numeric * v_it.count) / v_units)::real,
      count = v_units,
      rot_at = least(v_into.rot_at, v_it.rot_at)
    where id = v_into.id;
  delete from item where id = v_it.id;
  return v_into.id;
end $fn$;

/*
 * And the same over a whole pack at once, for the doors that move a handful of
 * rows in one statement and for the one-off tidy at the end of this file.
 *
 * One group-by rather than a fold per row: a pack of two thousand things is
 * one pass either way, and this is what makes the backfill possible.
 */
create or replace function pack_fold(p_world uuid, p_uid uuid) returns integer
  language plpgsql as $fn$
declare r record; v_gone int := 0;
begin
  for r in
    select min(i.id) as keep, array_agg(i.id) as ids, sum(i.count)::int as units,
           sum(i.ql::numeric * i.count) / sum(i.count) as ql,
           sum(i.dmg::numeric * i.count) / sum(i.count) as dmg,
           min(i.rot_at) as rot_at
      from item i
     where i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid
       and stack_key(i) is not null and item_stackable(i.def)
     group by stack_key(i)
    having count(i.id) > 1
  loop
    update item set ql = least(100, greatest(0, r.ql))::real, dmg = greatest(0, r.dmg)::real,
                    count = r.units, rot_at = r.rot_at
      where id = r.keep;
    delete from item where id = any(r.ids) and id <> r.keep;
    v_gone := v_gone + array_length(r.ids, 1) - 1;
  end loop;
  return v_gone;
end $fn$;

CREATE OR REPLACE FUNCTION public.give(p_world uuid, p_uid uuid, p_item text, p_n integer, p_ql double precision, p_extra text DEFAULT NULL::text, p_rare text DEFAULT NULL::text, p_maker text DEFAULT NULL::text, p_cast text DEFAULT NULL::text)
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
  insert into item (world_id, holder, holder_uid, def, ql, count, extra, rare, maker, piece)
  values (p_world, 'player', p_uid, p_item, greatest(0, least(100, p_ql)), p_n, p_extra, p_rare, p_maker, p_cast)
  returning id into found;
  return found;
end $function$;

CREATE OR REPLACE FUNCTION public.perform_crate(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare v_p player; v_it item; v_c crate; v_tx int; v_ty int; v_sx int; v_sy int; v_new_id int;
        v_want int; v_fit int; v_names text[] := '{}'; v_r record; v_kind text;
begin
  select * into v_p from player where world_id = p_world and uid = p_uid;

  if p_action = 'place_crate' then
    v_tx := (p_target->>'x')::int; v_ty := (p_target->>'y')::int;
    v_sx := (p_target->>'sx')::int; v_sy := (p_target->>'sy')::int;
    select * into v_it from item where id = target_item(p_target);
    v_kind := crate_kind_of_item(v_it.def);
    if v_kind is null or not consume(p_world, p_uid, v_it.def, 1, v_it.id) then return; end if;
    select coalesce(max(id), 0) + 1 into v_new_id from crate where world_id = p_world;
    insert into crate (world_id, id, kind, x, y, sx, sy, material, made_by)
    values (p_world, v_new_id, v_kind, v_tx, v_ty, v_sx, v_sy, v_it.extra, p_uid);
    select * into v_c from crate where world_id = p_world and id = v_new_id;
    perform journal_note(p_world, p_uid, 'crate');
    perform tell(p_world, p_uid, 'You set the ' || lower(crate_name(v_c)) || ' down.', 'event');

  elsif p_action = 'pick_up_crate' then
    v_c := target_crate(p_world, p_target);
    if v_c.id is null or crate_units(p_world, v_c.id) > 0 then return; end if;
    delete from crate where world_id = p_world and id = v_c.id;
    perform give(p_world, p_uid, (select item from crate_def where crate_def.kind = v_c.kind), 1, 20, v_c.material);
    perform tell(p_world, p_uid, 'You pick up the '
      || lower((select name from crate_def where crate_def.kind = v_c.kind)) || '.'
      || case when v_c.deed then ' Deed workers will leave their finds by the token until a deed crate stands again.'
              else '' end, 'event');

  elsif p_action = 'crate_take_all' then
    v_c := target_crate(p_world, p_target);
    if v_c.id is null then return; end if;
    for v_r in select * from item where world_id = p_world and holder = 'crate' and crate = v_c.id order by id loop
      v_names := v_names || (case when v_r.count > 1 then v_r.count || ' × ' else '' end
        || made_name(v_r.def, v_r.piece));
      update item set holder = 'player', holder_uid = p_uid, crate = null, gx = null, gy = null
        where id = v_r.id;
    end loop;
    -- And onto the piles already in the pack. Emptying a crate is the loudest
    -- of these: a worker fills it a load at a time, so a crate of seeds is a
    -- dozen stacks, and taking them all used to put a dozen stacks in the pack.
    perform pack_fold(p_world, p_uid);
    if array_length(v_names, 1) is null then return; end if;
    perform tell(p_world, p_uid, 'You take ' || array_to_string(v_names, ', ') || ' from the crate.', 'event');

  elsif p_action = 'store_in_crate' then
    v_c := named_crate(p_world, v_p.x, v_p.y, p_target);
    if v_c.id is null then v_c := nearest_crate(p_world, v_p.x, v_p.y); end if;
    select * into v_it from item where id = target_item(p_target);
    if v_c.id is null or not found then return; end if;
    v_want := greatest(1, least(v_it.count, coalesce((p_target->>'count')::int, 1)));
    if coalesce((select stackable from item_def where id = v_it.def), false) then
      -- Stackables merge into the crate's own stack of them, a part at a time,
      -- and as far as there is room: what is over stays in the pack.
      v_fit := least(v_want, crate_spare(p_world, v_c));
      if v_fit <= 0 or not crate_add(p_world, v_c.id, v_it.def, v_fit, v_it.ql, v_it.extra, v_it.piece) then
        perform tell(p_world, p_uid, 'The ' || lower(crate_name(v_c)) || ' is full.', 'error');
        return;
      end if;
      if v_fit >= v_it.count then delete from item where id = v_it.id;
      else update item set count = count - v_fit where id = v_it.id; end if;
    else
      -- Anything else is the same row moved into the crate, so a bag keeps
      -- what is in it: the contents belong to the bag, wherever the bag is.
      -- The row used to be copied and the original deleted, and the deletion
      -- took the bag's contents with it.
      if crate_units(p_world, v_c.id) + v_it.count > crate_capacity(v_c) then
        perform tell(p_world, p_uid, 'The ' || lower(crate_name(v_c)) || ' is full.', 'error');
        return;
      end if;
      update item set holder = 'crate', holder_uid = null, crate = v_c.id, gx = v_c.x, gy = v_c.y, inside = null, placed = null
        where id = v_it.id;
      v_fit := v_it.count;
    end if;
    perform tell(p_world, p_uid,
      stored_line(v_fit, made_name(v_it.def, v_it.piece), crate_name(v_c), v_want - v_fit), 'event');

  elsif p_action = 'take_from_store' then
    select * into v_it from item where id = target_item(p_target) and world_id = p_world;
    if not found or v_it.holder not in ('crate', 'furniture', 'bag') then return; end if;
    v_want := greatest(1, least(v_it.count, coalesce((p_target->>'count')::int, 1)));
    -- `move_part` splits the stack, merges into one you already carry, and
    -- clears whichever of `crate` and `placed` was holding it.
    if move_part(v_it.id, v_want, 'player', p_uid, null, null) is null then return; end if;
    perform tell(p_world, p_uid, 'You take '
      || case when v_want > 1 then v_want || ' × ' else 'the ' end
      || lower((select coalesce(name, v_it.def) from item_def where id = v_it.def))
      || ' out.', 'event');
  end if;
end $function$;

CREATE OR REPLACE FUNCTION public.perform_hands(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare it item; p player; v_x int; v_y int; v_want int; v_name text; v_was text;
        v_took bigint[]; v_row record; v_left int;
begin
  select * into p from player where world_id = p_world and uid = p_uid;

  if p_action = 'examine' then
    perform tell(p_world, p_uid,
      examine_tile_text(p_world, (p_target->>'x')::int, (p_target->>'y')::int), 'event');

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
    if v_want >= it.count then
      -- The whole stack goes down as it stands, keeping its own number.
      update item set holder = 'ground', holder_uid = null, gx = floor(p.x)::int, gy = floor(p.y)::int,
          locked = false, made_at = now()
        where id = it.id;
    else
      update item set count = it.count - v_want where id = it.id;
      perform drop_on_ground(p_world, floor(p.x)::int, floor(p.y)::int, it.def, it.ql, it.extra, v_want);
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
    update item set holder = 'player', holder_uid = p_uid, gx = null, gy = null where id = it.id;
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
      update item set holder = 'player', holder_uid = p_uid, gx = null, gy = null where id = v_row.id;
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

CREATE OR REPLACE FUNCTION public.perform_holding(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare it item; p placed; v_bag item; v_want int; v_fit int; v_moved bigint; v_names text; v_n int;
begin
  if p_action = 'furniture_take_all' then
    select * into p from placed where world_id = p_world and id = (p_target->>'id')::bigint;
    if not found then return; end if;
    select string_agg(case when q.count > 1 then q.count || ' × ' || lower(item_name(q))
                           else lower(item_name(q)) end, ', ' order by q.id), count(*)
      into v_names, v_n
      from item q where q.placed = p.id and q.holder = 'furniture';
    if v_n = 0 then return; end if;
    update item set holder = 'player', holder_uid = p_uid, placed = null
      where placed = p.id and holder = 'furniture';
    perform pack_fold(p_world, p_uid);
    perform tell(p_world, p_uid, 'You take ' || v_names || ' out of the '
      || lower(placed_name(p)) || '.', 'event');
    return;
  end if;

  select * into it from item where world_id = p_world and id = target_item(p_target)
    and holder = 'player' and holder_uid = p_uid;
  if not found then return; end if;
  v_want := greatest(1, least(coalesce((p_target->>'count')::int, 1), it.count));

  if p_action = 'stow_item' then
    v_bag := first_bag(p_world, p_uid, it.def, 1);
    if v_bag.id is null then return; end if;
    v_fit := least(v_want, bag_spare(v_bag));
    if v_fit <= 0 then return; end if;
    v_moved := move_part(it.id, v_fit, 'bag', p_uid, v_bag.id, null);
    if v_moved is null then return; end if;
    perform tell(p_world, p_uid, stored_line(v_fit, item_name(it),
      (select name from item_def where id = v_bag.def), v_want - v_fit), 'event');

  elsif p_action = 'empty_bag' then
    select count(*) into v_n from item where inside = it.id and holder = 'bag';
    -- Back through `move_part` rather than a bare update, so what comes out
    -- merges into the stack it left rather than sitting beside it.
    for v_bag in select * from item where inside = it.id and holder = 'bag' order by id loop
      perform move_part(v_bag.id, v_bag.count, 'player', p_uid, null, null);
    end loop;
    perform tell(p_world, p_uid, 'You turn the '
      || lower((select name from item_def where id = it.def)) || ' out: ' || v_n
      || case when v_n = 1 then ' thing' else ' things' end || ' back in your pack.', 'event');

  elsif p_action = 'store_in_furniture' then
    p := named_store(p_world, p_uid, p_target);
    if p.id is null then p := nearest_store(p_world, p_uid, it.def, 1); end if;
    if p.id is null then return; end if;
    v_fit := least(v_want, furniture_spare(p));
    if v_fit <= 0 then return; end if;
    v_moved := move_part(it.id, v_fit, 'furniture', null, null, p.id);
    if v_moved is null then return; end if;
    perform tell(p_world, p_uid,
      stored_line(v_fit, item_name(it), placed_name(p), v_want - v_fit), 'event');

  elsif p_action = 'throw_away' then
    p := trash_near(p_world, p_uid);
    if p.id is null then return; end if;
    v_moved := move_part(it.id, v_want, 'furniture', null, null, p.id);
    if v_moved is null then return; end if;
    perform tell(p_world, p_uid, 'You throw '
      || case when v_want > 1 then v_want || ' × ' else 'the ' end || lower(item_name(it))
      || ' in the trash crate. It will not last long in there.', 'event');
  end if;
end $function$;

CREATE OR REPLACE FUNCTION public.perform_trap(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare p placed; d trap_def; it item; c creature; s species_def; dd deed;
        v_sx int; v_sy int; v_names text; v_comers int; v_clean boolean; v_back bigint;
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

CREATE OR REPLACE FUNCTION public.rpc_buy(p_world uuid, p_item bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare me uuid := auth.uid(); v_it item; v_pl placed; p player; v_name text;
begin
  if me is null then raise exception 'not signed in'; end if;
  if too_fast(me) then raise exception 'you are asking too quickly; slow down'; end if;
  select * into p from player where world_id = p_world and uid = me;
  if not found then raise exception 'you are not on this island'; end if;
  select * into v_it from item where world_id = p_world and id = p_item for update;
  if not found or v_it.price is null or v_it.placed is null then
    return jsonb_build_object('why', 'That is not for sale.');
  end if;
  select * into v_pl from placed where world_id = p_world and id = v_it.placed;
  if not found then return jsonb_build_object('why', 'That is not for sale.'); end if;
  if v_pl.made_by = me then
    return jsonb_build_object('why', 'It is your own stall. Take it back off the counter instead.');
  end if;
  if greatest(abs(v_pl.x + 0.5 - p.x), abs(v_pl.y + 0.5 - p.y)) > 2.4 then
    return jsonb_build_object('why', 'Stand at the counter.');
  end if;
  if purse(p_world, me) < v_it.price then
    return jsonb_build_object('why', 'You cannot afford it. It is ' || v_it.price || ' silver.');
  end if;
  if not take_coins(p_world, me, v_it.price) then
    return jsonb_build_object('why', 'You cannot afford it.');
  end if;
  update placed set till = till + v_it.price where world_id = p_world and id = v_pl.id;
  v_name := lower(coalesce((select name from item_def where id = v_it.def), v_it.def));
  update item set holder = 'player', holder_uid = me, placed = null, price = null
    where world_id = p_world and id = v_it.id;
  perform pack_fold_one(v_it.id);
  if v_pl.made_by is not null then
    perform tell(p_world, v_pl.made_by, folk_name(p_world, me) || ' buys your ' || v_name
      || ' for ' || v_it.price || ' silver.', 'event');
  end if;
  return jsonb_build_object('bought', v_name, 'paid', v_it.price);
end $function$;

CREATE OR REPLACE FUNCTION public.rpc_collect(p_world uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare me uuid := auth.uid(); v_box placed; v_count int;
begin
  if me is null then raise exception 'not signed in'; end if;
  if too_fast(me) then raise exception 'you are asking too quickly; slow down'; end if;
  v_box := mailbox_at(p_world, me);
  if v_box.id is null then return jsonb_build_object('why', 'Stand at a mailbox.'); end if;
  select count(*) into v_count from item
    where world_id = p_world and holder = 'post' and holder_uid = me;
  if v_count = 0 then return jsonb_build_object('why', 'Nothing is waiting for you.'); end if;
  update item set holder = 'player', letter = null
    where world_id = p_world and holder = 'post' and holder_uid = me;
  perform pack_fold(p_world, me);
  return jsonb_build_object('took', v_count);
end $function$;

create or replace function item_raw(p_def text) returns boolean
  language sql stable as $fn$ select coalesce(raw, false) from item_def where id = p_def $fn$;

CREATE OR REPLACE FUNCTION public.worker_store(p_world uuid, c creature, p_def text, p_count integer)
 RETURNS TABLE(kind text, id bigint, cx double precision, cy double precision)
 LANGUAGE plpgsql
 STABLE
AS $function$
declare v_site record; v_own boolean; v_raw boolean;
begin
  /*
   * A raw material bin takes the load first, when the load is raw.
   *
   * Asked for: "molas should prioritize storing into raw material bins." A
   * bin holds four hundred where a crate holds a fraction of that, and it
   * takes nothing a bench has touched -- so it is the one store built for
   * exactly what a worker brings home by the cartload, and it was competing
   * for the job on distance alone. Worse, a worker that filled the deed crate
   * with ore left nowhere for the things only a crate will hold.
   *
   * Only for a raw load, and only ahead of the ordering that was already
   * here: nearest bin first, and failing a bin the same deed crate and the
   * same nearest store as before.
   */
  v_raw := item_raw(p_def);
  select * into v_site from work_site(p_world, c);
  if v_site.x is null then return; end if;
  -- Beside the post first, when it is working off one.
  if v_site.post is not null then
    return query
    with room as (
      select 'crate'::text as kind, cr.id::bigint as id, crate_centre_x(cr) as cx, crate_centre_y(cr) as cy,
             false as bin
      from crate cr
      where cr.world_id = p_world
        and abs(cr.x + 0.5 - v_site.x) <= v_site.radius and abs(cr.y + 0.5 - v_site.y) <= v_site.radius
        and crate_units(p_world, cr.id) + p_count <= crate_capacity(cr)
      union all
      select 'furniture', p.id, p.x + 0.5, p.y + 0.5, fd.raw
      from placed p join furniture_def fd on fd.id = p.sub
      where p.world_id = p_world and p.kind = 'furniture'
        and abs(p.x + 0.5 - v_site.x) <= v_site.radius and abs(p.y + 0.5 - v_site.y) <= v_site.radius
        and furniture_capacity(p) > 0 and furniture_refuses(p, p_def) is null
        and furniture_units(p) + p_count <= furniture_capacity(p))
    select r.kind, r.id, r.cx, r.cy from room r
    order by (v_raw and r.bin) desc, (r.cx - creature_x(c)) ^ 2 + (r.cy - creature_y(c)) ^ 2
    limit 1;
    if found then return; end if;
  end if;
  -- Then home: the settlement's own crate while it has room, and the nearest
  -- thing on the deed that will take it after.
  return query
  with mine as (select * from my_deed(p_world, c.keeper) md where md.world_id is not null),
  room as (
    select 'crate'::text as kind, cr.id::bigint as id, crate_centre_x(cr) as cx, crate_centre_y(cr) as cy,
           cr.deed as own, false as bin
    from crate cr, mine d
    where cr.world_id = p_world
      and abs(cr.x - d.x) <= d.radius and abs(cr.y - d.y) <= d.radius
      and crate_units(p_world, cr.id) + p_count <= crate_capacity(cr)
    union all
    select 'furniture', p.id, p.x + 0.5, p.y + 0.5, false, fd.raw
    from placed p join furniture_def fd on fd.id = p.sub, mine d
    where p.world_id = p_world and p.kind = 'furniture'
      and abs(p.x - d.x) <= d.radius and abs(p.y - d.y) <= d.radius
      and furniture_capacity(p) > 0 and furniture_refuses(p, p_def) is null
      and furniture_units(p) + p_count <= furniture_capacity(p))
  select r.kind, r.id, r.cx, r.cy from room r
  order by (v_raw and r.bin) desc, r.own desc,
           (r.cx - creature_x(c)) ^ 2 + (r.cy - creature_y(c)) ^ 2
  limit 1;
end $function$;


/*
 * And the packs that are already a mess.
 *
 * The screenshot that started this had six separate piles of cotton seeds in
 * one pack out of 1,996 things, which is a pack nobody can read. Every one of
 * those piles arrived through a door that moved a row and folded nothing, and
 * fixing the doors does nothing for what they have already done -- so this
 * walks every pack on every island once, through the same rule.
 *
 * It does not change what anybody is carrying by a gram: a stack of four and
 * a stack of three become a stack of seven at the average of the two. Only
 * the number of rows goes down.
 */
do $$
declare r record; v_packs int := 0; v_gone int := 0; n int;
begin
  for r in select p.world_id, p.uid from player p loop
    n := pack_fold(r.world_id, r.uid);
    if n > 0 then v_packs := v_packs + 1; v_gone := v_gone + n; end if;
  end loop;
  raise notice 'folded % stray stacks away, across % packs', v_gone, v_packs;
end $$;


notify pgrst, 'reload schema';
select private.lock_doors();
