-- The body learns from the heavy trades, and a container's contents are its own
--
-- Two things asked for.
--
-- Digging and mining train body strength. The body already learned from the
-- work itself, wind from spending it and control from doing it, in the one
-- place both sides pay for a go; the back joins them there for the trades
-- that are heavy work, which the skill table now marks (`skill_def.heavy`),
-- at `work_back` a go, whatever the go found. Both sides read the same list
-- and the same number.
--
-- What is in a container belongs to the container, not to a player, and
-- every container is a line of a table. A crate's and a piece of furniture's
-- contents already named their container and carried no holder of their
-- own; a bag's contents carried the uid of whoever put them in, for the pack
-- stream, and kept it when the bag was dropped, stored or picked up by
-- somebody else, so a satchel on the ground was still in its dropper's pack
-- and one a friend picked up held things that were not theirs. The contents
-- follow the bag now, by a trigger on the bag's row: they carry the bag's
-- holder and no other, and moving the bag moves them. Storing a bag in a
-- crate copied the bag's row and deleted the original, and the deletion took
-- the contents with it; the row moves into the crate now, as it does into
-- furniture. And `container` is the one table where every container reads
-- alike, a line each: what it is, where it stands or who carries it, and
-- what is in it.

/**
 * What is in a bag belongs to the bag, and the bag to whoever holds it: the
 * contents carry the bag's holder, so a pack streams whole, and follow it.
 */
create or replace function private.bag_contents_follow() returns trigger language plpgsql as $fn$
begin
  update item set holder_uid = new.holder_uid
    where inside = new.id and holder = 'bag' and holder_uid is distinct from new.holder_uid;
  return null;
end $fn$;
drop trigger if exists item_bag_follows on item;
create trigger item_bag_follows after update of holder, holder_uid on item
  for each row when (old.holder_uid is distinct from new.holder_uid)
  execute function private.bag_contents_follow();

-- And whatever a bag already held under its old holder follows it now.
update item i set holder_uid = b.holder_uid
  from item b where b.id = i.inside and i.holder = 'bag' and i.holder_uid is distinct from b.holder_uid;

/**
 * Every container on an island, one line each. A crate and a piece of
 * furniture are lines of their own tables and a bag is an item; this is the
 * one place they read alike: what it is, where it stands or who carries it,
 * and how much is in it against what it holds.
 */
create or replace view container with (security_invoker = true) as
  select 'crate'::text as kind, c.world_id, c.id::bigint as id, coalesce(c.name, crate_name(c)) as name,
         c.x, c.y, null::uuid as holder_uid, crate_units(c.world_id, c.id) as units, crate_capacity(c) as capacity
    from crate c
  union all
  select 'furniture', p.world_id, p.id, coalesce(p.name, f.name), p.x, p.y, null::uuid,
         (select coalesce(sum(i.count), 0)::int from item i where i.holder = 'furniture' and i.placed = p.id), f.capacity::int
    from placed p join furniture_def f on f.id = p.sub
    where p.kind = 'furniture' and f.capacity > 0
  union all
  select 'bag', b.world_id, b.id, d.name, b.gx, b.gy, b.holder_uid, bag_units(b.id), d.holds::int
    from item b join item_def d on d.id = b.def
    where d.holds > 0;
grant select on container to anon, authenticated;

CREATE OR REPLACE FUNCTION public.spend_wind(p_world uuid, p_uid uuid, p_action text)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare cost double precision; w double precision; body double precision; spent double precision;
begin
  /*
   * What the go taught the hands, whatever it was and whatever it cost.
   *
   * Before the wind, and outside the guard below, because a go that costs no
   * wind is still a go: the browser pays this on every one and the island paid
   * it on none. It is not the digging skill — a body that has swung a shovel a
   * thousand times has a steadier hand than one that has not, at anything.
   */
  perform char_told(p_world, p_uid, 'body_control', work_hand());
  -- And the back, from the heavy trades: a shovel or a pick, whatever the go found.
  if coalesce((select s.heavy from action_def a join skill_def s on s.id = a.skill where a.id = p_action), false) then
    perform char_told(p_world, p_uid, 'body_strength', work_back());
  end if;
  select stamina into cost from action_def where id = p_action;
  if coalesce(cost, 0) <= 0 then return; end if;
  perform body_settle(p_world, p_uid);
  -- A hardy body spends less on the same job. No burden here: the island does
  -- not know what you are carrying.
  body := greatest(0.45, 1 - greatest(0, skill_of(p_world, p_uid, 'body_stamina') - char_start()) * 0.0045);
  spent := cost * body;
  select coalesce((stats->>'stamina')::double precision, 1) into w
    from player where world_id = p_world and uid = p_uid;
  update player set stats = jsonb_set(coalesce(stats, '{}'::jsonb), '{stamina}',
      to_jsonb(greatest(0, w - spent)))
    where world_id = p_world and uid = p_uid;
  /*
   * And what spending it taught the chest.
   *
   * On what was actually spent rather than on what the job lists, so the same
   * dig teaches a tired body and a hardy one differently — which is the same
   * arithmetic the wind itself came off. The browser reckons its own spend
   * with the burden folded in and this island does not know what anybody is
   * carrying, so a laden body learns a shade less here than the browser drew
   * while it waited. That gap is the burden's, and it was there before this.
   */
  perform char_told(p_world, p_uid, 'body_stamina', work_wind() + spent * work_wind_spent());
end $function$

;

CREATE OR REPLACE FUNCTION public.perform_crate(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare v_p player; v_it item; v_c crate; v_tx int; v_ty int; v_sx int; v_sy int; v_new_id int;
        v_want int; v_names text[] := '{}'; v_r record; v_kind text;
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
        || lower((select coalesce(name, v_r.def) from item_def where id = v_r.def)));
      update item set holder = 'player', holder_uid = p_uid, crate = null, gx = null, gy = null
        where id = v_r.id;
    end loop;
    if array_length(v_names, 1) is null then return; end if;
    perform tell(p_world, p_uid, 'You take ' || array_to_string(v_names, ', ') || ' from the crate.', 'event');

  elsif p_action = 'store_in_crate' then
    v_c := nearest_crate(p_world, v_p.x, v_p.y);
    select * into v_it from item where id = target_item(p_target);
    if v_c.id is null or not found then return; end if;
    v_want := greatest(1, least(v_it.count, coalesce((p_target->>'count')::int, 1)));
    if coalesce((select stackable from item_def where id = v_it.def), false) then
      -- Stackables merge into the crate's own stack of them, a part at a time.
      if not crate_add(p_world, v_c.id, v_it.def, v_want, v_it.ql, v_it.extra) then
        perform tell(p_world, p_uid, 'The crate is full.', 'error');
        return;
      end if;
      if v_want >= v_it.count then delete from item where id = v_it.id;
      else update item set count = count - v_want where id = v_it.id; end if;
    else
      -- Anything else is the same row moved into the crate, so a bag keeps
      -- what is in it: the contents belong to the bag, wherever the bag is.
      -- The row used to be copied and the original deleted, and the deletion
      -- took the bag's contents with it.
      if crate_units(p_world, v_c.id) + v_it.count > crate_capacity(v_c) then
        perform tell(p_world, p_uid, 'The crate is full.', 'error');
        return;
      end if;
      update item set holder = 'crate', holder_uid = null, crate = v_c.id, gx = v_c.x, gy = v_c.y, inside = null, placed = null
        where id = v_it.id;
    end if;
    perform tell(p_world, p_uid, 'You put ' || case when v_want > 1 then v_want || ' × ' else 'the ' end
      || lower((select coalesce(name, v_it.def) from item_def where id = v_it.def))
      || ' in the ' || lower((select name from crate_def where crate_def.kind = v_c.kind)) || '.', 'event');

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
end $function$

;

-- The definitions before this added a column, and there is a view the API sees.
notify pgrst, 'reload schema';

select private.lock_doors();
