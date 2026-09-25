/*
 * Creature crates.
 *
 * Asked for: "Creature crates cost 8 planks and 4 nails, and 2 ribbons.
 * Wildermon can be tamed to be set to active if currently no active
 * wildermon, but any additional wildermon cannot be tamed unless the player
 * carries a creature crate. Creature crates can be placed on the ground and
 * display the wildermon inside them. They weigh 10kg. Wildermon can no longer
 * be Kept at Token. Interacting with a creature crate allows you to pick it up
 * / place it, assign the creature to active, or assign the creature to work
 * the deed."
 *
 * The crate itself -- its bill, its weight, its recipe and the three things
 * that can be asked of it -- is the rulebook's and comes in with the
 * definitions. What is here is the island's half, and it says the same as
 * `src/game/creaturecrate.ts`:
 *
 *   * A crate holds one wildermon, and the crate knows which: `item.creature`
 *     while it is in the pack, `placed.creature` while it stands on the
 *     ground. The wildermon's own mode is `stored`, which has always meant put
 *     away -- not moving, not eating, not drawn in the world -- and now means
 *     put away in a crate. There is no token to keep one at any more.
 *
 *   * Taming: the first follows you; every one after that goes into an empty
 *     crate at the top of your pack, and without one there is no taming it. A
 *     catch taken out of a trap is the same.
 *
 *   * `crate_creature` puts a companion or a worker into an empty crate you
 *     carry. `crate_follow` lets the one in a crate out to follow you -- the
 *     companion you had goes into the crate in its place -- and `crate_work`
 *     lets it out to work the deed. Both are asked of the crate, standing or
 *     carried.
 *
 *   * A crate with a wildermon in it is carried, set down or opened, and
 *     nothing else: it is not dropped, bagged, stored, sold, posted or traded.
 *     The door says so, and a trigger stops anything that gets past a door.
 *
 *   * A worker taken off the deed to follow you leaves the one that was
 *     following you on the deed in its place, when the settlement has work for
 *     it; otherwise in an empty crate you carry; otherwise it is not taken.
 *
 *   * Nothing that young is put to work. A young one is born into the herd of
 *     its keeper's settlement and keeps about it until it is grown, taking no
 *     place on the deed's books until then; without a settlement it follows
 *     you, or goes into an empty crate you carry, or goes off into the wild.
 *     It used to be born into the token with nobody's name on it.
 *
 *   * Every wildermon that was kept at a token is put in a crate of its own at
 *     the end of this file: set down beside its keeper's token where there is
 *     room, and in the keeper's pack where there is not.
 */
set local lock_timeout = '3s';

alter table item add column if not exists creature int;
alter table placed add column if not exists creature int;
create index if not exists item_creature on item (world_id, creature) where creature is not null;
create index if not exists placed_creature on placed (world_id, creature) where creature is not null;

/* ---- the crate ------------------------------------------------------------- */

-- An empty creature crate at the top of the pack, the first there is.
create or replace function empty_crate(p_world uuid, p_uid uuid) returns bigint
language sql stable as $$
  select i.id from item i
   where i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid
     and i.def = 'creature_crate' and i.creature is null
   order by i.id limit 1
$$;

-- Why one more wildermon cannot be tamed, or null: the first follows you, and
-- every one after that goes into an empty creature crate you carry.
create or replace function tame_room_refusal(p_world uuid, p_uid uuid) returns text
language sql stable as $$
  select c.name || ' already follows you. Carry an empty creature crate to tame another: it goes into the crate.'
    from creature c
   where c.world_id = p_world and c.keeper = p_uid and c.mode = 'active'
     and empty_crate(p_world, p_uid) is null
   limit 1
$$;

-- What a worker set to the deed will do, said the same way however it got there.
create or replace function deed_job_line(c creature) returns text
language sql stable as $$
  select coalesce((select g.plain || ' within ' || work_range(c)
                          || ' tiles of the token and bring what it finds to the crate'
                     from gather_def g
                    where g.id = coalesce(c.job, (select s.gathers from species_def s where s.id = c.species))),
                  'stay around the settlement')
$$;

/*
 * Shut a wildermon in a crate: the one at the top of the pack named by
 * `p_item`, or the one standing on the ground named by `p_placed`. Whatever it
 * was carrying is put down where it stood and a post it was at is let go. It
 * stands where the crate is -- at the crate, or at its keeper's feet -- and it
 * does not get hungry in there, which `hunger_rate` has always said of `stored`.
 */
create or replace function crate_shut_in(p_world uuid, p_id int, p_item bigint, p_placed bigint) returns void
language plpgsql as $$
declare v_c creature; v_x double precision; v_y double precision;
begin
  if p_item is null and p_placed is null then return; end if;
  select * into v_c from creature where world_id = p_world and id = p_id for update;
  if not found then return; end if;
  if v_c.carrying is not null then
    perform drop_on_ground(p_world, floor(creature_x(v_c))::int, floor(creature_y(v_c))::int,
      v_c.carrying->>'def', coalesce((v_c.carrying->>'ql')::double precision, 1), v_c.carrying->>'extra',
      coalesce((v_c.carrying->>'count')::int, 1));
  end if;
  if p_placed is not null then
    select pl.cx, pl.cy into v_x, v_y from placed pl where pl.world_id = p_world and pl.id = p_placed;
  else
    select py.x, py.y into v_x, v_y from player py where py.world_id = p_world and py.uid = v_c.keeper;
  end if;
  v_x := coalesce(v_x, creature_x(v_c)); v_y := coalesce(v_y, creature_y(v_c));
  update creature set mode = 'stored', post = null, phase = 'idle', carrying = null,
      work_x = null, work_y = null, enemy = null, hunting = null,
      from_x = v_x, from_y = v_y, to_x = v_x, to_y = v_y,
      leg_at = now(), leg_ends = now(), until = now(), settled_at = now()
    where world_id = p_world and id = p_id;
  if p_placed is not null then
    update placed set creature = p_id where world_id = p_world and id = p_placed;
  else
    update item set creature = p_id where world_id = p_world and id = p_item;
  end if;
end $$;

/*
 * Let a wildermon out of the crate it is in: the crate forgets it, and it
 * stands at the crate's door -- in front of one standing on the ground, on the
 * side it faces, and at its keeper's feet from one carried.
 */
create or replace function crate_let_out(p_world uuid, p_id int) returns void
language plpgsql as $$
declare v_pl placed; v_x double precision; v_y double precision; v_keeper uuid;
begin
  select * into v_pl from placed where world_id = p_world and creature = p_id limit 1;
  if v_pl.id is not null then
    v_x := v_pl.cx + case v_pl.facing when 'e' then 0.6 when 'w' then -0.6 else 0 end;
    v_y := v_pl.cy + case v_pl.facing when 'n' then -0.6 when 'e' then 0 when 'w' then 0 else 0.6 end;
  else
    select keeper into v_keeper from creature where world_id = p_world and id = p_id;
    select py.x, py.y into v_x, v_y from player py where py.world_id = p_world and py.uid = v_keeper;
  end if;
  update placed set creature = null where world_id = p_world and creature = p_id;
  update item set creature = null where world_id = p_world and creature = p_id;
  if v_x is not null then
    update creature set from_x = v_x, from_y = v_y, to_x = v_x, to_y = v_y, phase = 'idle',
        leg_at = now(), leg_ends = now(), until = now(), settled_at = now()
      where world_id = p_world and id = p_id;
  end if;
end $$;

-- The crate an action is aimed at, standing on the ground or at the top of the pack, and who is in it.
create or replace function crate_aimed(p_world uuid, p_uid uuid, p_target jsonb,
    out v_item bigint, out v_placed bigint, out v_creature int)
language plpgsql stable as $$
begin
  if p_target->>'kind' = 'furniture' then
    select pl.id, pl.creature into v_placed, v_creature from placed pl
     where pl.world_id = p_world and pl.id = nullif(p_target->>'id', '')::bigint
       and pl.kind = 'furniture' and pl.sub = 'creature_crate';
  elsif p_target->>'kind' = 'item' then
    select i.id, i.creature into v_item, v_creature from item i
     where i.world_id = p_world and i.id = target_item(p_target)
       and i.holder = 'player' and i.holder_uid = p_uid and i.def = 'creature_crate';
  end if;
end $$;

/*
 * Why a crate will not be opened from where you stand, or null: to have the
 * one in it follow you (the companion you have goes into the crate in its
 * place), or to set it to work the deed.
 */
create or replace function crate_open_refusal(p_world uuid, p_uid uuid, p_action text, p_target jsonb) returns text
language plpgsql as $$
declare v_at record; v_c creature; v_cur creature; v_d species_def; v_dd deed;
begin
  select * into v_at from crate_aimed(p_world, p_uid, p_target);
  if v_at.v_item is null and v_at.v_placed is null then return 'That is not a creature crate.'; end if;
  if v_at.v_creature is null then return 'The crate is empty.'; end if;
  select * into v_c from creature where world_id = p_world and id = v_at.v_creature;
  if not found then return 'The crate is empty.'; end if;
  if v_c.mode <> 'stored' then return v_c.name || ' is not in it.'; end if;
  if v_c.keeper is distinct from p_uid then return v_c.name || ' is not yours to let out.'; end if;
  if v_at.v_placed is not null and not placed_in_reach(p_world, p_uid, v_at.v_placed) then
    return 'Stand next to the crate.';
  end if;
  if p_action = 'crate_follow' then
    select * into v_cur from creature where world_id = p_world and keeper = p_uid and mode = 'active' limit 1;
    if v_cur.id is not null and v_cur.hitched_to is not null then
      return v_cur.name || ' is in the traces, and would have to go into the crate in its place. Take it out first.';
    end if;
    if v_cur.id is not null and v_cur.rider is not null then
      return 'Get down off ' || v_cur.name || ' first: it goes into the crate in its place.';
    end if;
    return null;
  end if;
  v_dd := my_deed(p_world, p_uid);
  if v_dd.world_id is null then return 'You have no settlement to set it to work on.'; end if;
  select * into v_d from species_def where id = v_c.species;
  if v_d.gathers is null then return 'A ' || lower(v_d.name) || ' has no trade to be set to.'; end if;
  if not worker_job_ported(v_d.gathers) then
    return 'Nobody has taught this island what '
      || (select plain from gather_def where id = v_d.gathers) || ' looks like yet.';
  end if;
  -- Only a grown one works, and so only a grown one takes a place.
  if (age_row(v_c.born)).works and workers_on_deed(p_world, p_uid) >= worker_cap(p_world, p_uid) then
    return v_dd.name || ' has work for ' || worker_cap(p_world, p_uid) || ' wildermon at level '
      || v_dd.level || '. Upgrade the settlement to take on more.';
  end if;
  return null;
end $$;

-- Opening a crate: the one in it follows you, or goes to work the deed.
create or replace function perform_crate_open(p_world uuid, p_uid uuid, p_action text, p_target jsonb) returns void
language plpgsql as $$
declare v_at record; v_c creature; v_cur creature; v_d species_def;
begin
  if crate_open_refusal(p_world, p_uid, p_action, p_target) is not null then return; end if;
  select * into v_at from crate_aimed(p_world, p_uid, p_target);
  select * into v_c from creature where world_id = p_world and id = v_at.v_creature for update;
  select * into v_d from species_def where id = v_c.species;
  if p_action = 'crate_follow' then
    select * into v_cur from creature where world_id = p_world and keeper = p_uid and mode = 'active' limit 1;
    perform crate_let_out(p_world, v_c.id);
    update creature set mode = 'active', enemy = null, hunting = null, settled_at = now()
      where world_id = p_world and id = v_c.id;
    if v_cur.id is not null then
      perform crate_shut_in(p_world, v_cur.id, v_at.v_item, v_at.v_placed);
      perform tell(p_world, p_uid, v_c.name || ' comes out of the crate and follows you. '
        || v_cur.name || ' goes into the crate in its place.', 'system');
    else
      perform tell(p_world, p_uid, v_c.name || ' comes out of the crate and follows you.', 'system');
    end if;
    perform creature_settle(p_world, v_c.id);
  else
    perform crate_let_out(p_world, v_c.id);
    update creature set mode = 'deed', keeper = p_uid, phase = 'idle', job = v_d.gathers,
        work_x = null, work_y = null, carrying = null, enemy = null, hunting = null, settled_at = now()
      where world_id = p_world and id = v_c.id returning * into v_c;
    perform tell(p_world, p_uid, case when (age_row(v_c.born)).works
        then v_c.name || ' comes out of the crate and will ' || deed_job_line(v_c) || '.'
        else v_c.name || ' comes out of the crate. It is not grown, and stays about the settlement until it is.' end,
      'system');
  end if;
end $$;

/*
 * Where the companion you have goes when a worker is taken off the deed to
 * follow you instead: onto the deed in its place, when the settlement has work
 * for one more once the worker leaves; otherwise into an empty creature crate
 * you carry; otherwise nowhere, and the worker stays where it is -- which is
 * `v_why`.
 */
create or replace function companion_swap(p_world uuid, p_uid uuid, p_taking creature,
    out v_current int, out v_to text, out v_why text)
language plpgsql stable as $$
declare v_cur creature; v_dd deed; v_freed int; v_adds int;
begin
  select * into v_cur from creature
   where world_id = p_world and keeper = p_uid and mode = 'active' and id <> p_taking.id limit 1;
  if v_cur.id is null then return; end if;
  v_current := v_cur.id;
  if v_cur.hitched_to is not null then v_why := v_cur.name || ' is in the traces. Take it out first.'; return; end if;
  if v_cur.rider is not null then v_why := 'Get down off ' || v_cur.name || ' first.'; return; end if;
  v_dd := my_deed(p_world, p_uid);
  -- What the deed counts once the one being taken is off it and this one is on it.
  v_freed := case when p_taking.mode = 'deed' and p_taking.post is null and (age_row(p_taking.born)).works then 1 else 0 end;
  v_adds := case when (age_row(v_cur.born)).works then 1 else 0 end;
  if v_dd.world_id is not null
     and workers_on_deed(p_world, p_uid) - v_freed + v_adds <= worker_cap(p_world, p_uid) then
    v_to := 'deed';
    return;
  end if;
  if empty_crate(p_world, p_uid) is not null then v_to := 'crate'; return; end if;
  v_why := case when v_dd.world_id is not null
    then v_cur.name || ' has nowhere to go: ' || v_dd.name || ' has work for ' || worker_cap(p_world, p_uid)
         || ' wildermon at level ' || v_dd.level || ', and you carry no empty creature crate.'
    else v_cur.name || ' has nowhere to go: you have no settlement to set it to work on, and you carry no empty creature crate.' end;
end $$;

/*
 * A crate with a wildermon in it is carried, set down or opened, and nothing
 * else is done with it: not dropped, bagged, stored, sold, posted or traded,
 * because a wildermon goes where its crate goes and nobody keeps yours but
 * you. These are the things that may be asked of one, the browser's list.
 */
create or replace function occupied_crate_refusal(p_world uuid, p_uid uuid, p_action text, p_target jsonb) returns text
language sql stable as $$
  select coalesce(c.name, 'A wildermon')
         || ' is in that crate. A crate with a wildermon in it can be carried, set down or opened, and nothing else.'
    from item i left join creature c on c.world_id = i.world_id and c.id = i.creature
   where p_action not in ('examine', 'examine_item', 'place_furniture', 'crate_follow', 'crate_work',
                          'lock_item', 'unlock_item', 'name_thing')
     and i.world_id = p_world and i.id = target_item(p_target) and i.creature is not null
$$;

/* And what gets past a door, by any road at all, is stopped here rather than losing a wildermon in a parcel. */
create or replace function occupied_crate_stays() returns trigger
language plpgsql as $$
begin
  if new.holder is distinct from 'player' or new.holder_uid is distinct from old.holder_uid
     or new.inside is not null or new.deal is not null or new.price is not null or new.letter is not null then
    raise exception 'A creature crate with a wildermon in it is carried or set down, and nothing else.';
  end if;
  return new;
end $$;
drop trigger if exists occupied_crate_stays on item;
create trigger occupied_crate_stays before update on item for each row
  when (old.creature is not null and new.creature is not null)
  execute function occupied_crate_stays();

/*
 * A wildermon out of its crate by any road -- let out, set to a post, culled,
 * released -- is out of it: the crate forgets it. Asked of the row rather than
 * of every door that changes a mode, so there is no door that can forget.
 */
create or replace function creature_left_crate() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' or new.mode is distinct from 'stored' then
    update item set creature = null where world_id = old.world_id and creature = old.id;
    update placed set creature = null where world_id = old.world_id and creature = old.id;
  end if;
  return null;
end $$;
drop trigger if exists creature_left_crate on creature;
create trigger creature_left_crate after update of mode or delete on creature
  for each row when (old.mode = 'stored')
  execute function creature_left_crate();

/*
 * The deed's books count what works it: grown, and not at a post. A young one
 * of the herd takes no place until it is grown, and one set to a post costs
 * no settlement slot, which is most of what a post is for -- as the browser
 * has always counted them.
 */
create or replace function workers_on_deed(p_world uuid, p_uid uuid) returns integer
language sql stable as $$
  select count(*)::int from creature c
   where c.world_id = p_world and c.keeper = p_uid and c.mode = 'deed' and c.post is null
     and (age_row(c.born)).works
$$;

/* A spot for a crate on the ground nearest a tile, out to `p_reach` tiles, the way the browser looks for one. */
create or replace function crate_spot_near(p_world uuid, p_x int, p_y int, p_reach int,
    out x int, out y int, out sx int, out sy int)
language plpgsql stable as $$
declare v_r int; v_dx int; v_dy int; v_ax int; v_ay int;
begin
  for v_r in 1..greatest(1, p_reach) loop
    for v_dy in -v_r..v_r loop
      for v_dx in -v_r..v_r loop
        if greatest(abs(v_dx), abs(v_dy)) <> v_r then continue; end if;
        if not creature_tile_ok(p_world, p_x + v_dx, p_y + v_dy) then continue; end if;
        for v_ay in 0..1 loop
          for v_ax in 0..1 loop
            if not block_taken(p_world, p_x + v_dx, p_y + v_dy, v_ax * 2, v_ay * 2, 2, 2, null) then
              x := p_x + v_dx; y := p_y + v_dy; sx := v_ax * 2; sy := v_ay * 2;
              return;
            end if;
          end loop;
        end loop;
      end loop;
    end loop;
  end loop;
end $$;

create or replace function creature_action(p_action text) returns boolean
language sql immutable as $$
  select p_action in ('examine_creature', 'tame', 'feed', 'groom', 'shear', 'milk_creature',
                      'set_stance', 'rename_creature', 'take_creature', 'crate_creature',
                      'crate_follow', 'crate_work',
                      'release_creature', 'cull_creature', 'assign_deed')
$$;

CREATE OR REPLACE FUNCTION public.act_refusal_rules(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS text
 LANGUAGE plpgsql
AS $function$
declare d action_def; p player; cx int; cy int; tx int; ty int; t tile_def; aimed text;
begin
  select * into d from action_def where id = p_action;
  if not found then return 'There is no such thing as ' || p_action || '.'; end if;
  select * into p from player where world_id = p_world and uid = p_uid;
  if not found then return 'You are not on this island.'; end if;
  -- Deliberately not "are you busy": asked of queued jobs too. That is rpc_act's.
  if not act_ported(p_action) then
    return 'You cannot ' || lower(d.label) || ' on this island yet.';
  end if;

  -- A crate with a wildermon in it is carried, set down or opened, and that is all.
  aimed := occupied_crate_refusal(p_world, p_uid, p_action, p_target);
  if aimed is not null then return aimed; end if;
  aimed := p_target->>'kind';
  -- Whose ground it is, before anything about what it is made of.
  aimed := ground_deed_refusal(p_world, p_uid, p_action, p_target);
  if aimed is not null then return aimed; end if;
  aimed := p_target->>'kind';
  -- The hour comes for a dam in young whoever is or is not standing there, and
  -- somebody is always about to do something. This is where they find out.
  perform herd_settle(p_world);
  -- The last ten answer for their own reach, every one of them: a bridge is
  -- worked from either bank, a bed is furniture, and a beast is not at a tile.
  -- First of all, because a map is an item and every other family that takes
  -- an item wants one it can name a use for. This one is aimed at the map.
  if treasure_action(p_action) then
    return treasure_refusal(p_world, p_uid, p_action, p_target);
  end if;
  if last_action(p_action) then
    return last_refusal(p_world, p_uid, p_action, p_target);
  end if;
  -- Then the only family that does not care what it is
  -- pointed at: a prayer wants an altar, a cast wants a name, and the other
  -- three want nothing but the ground you are sitting on.
  if faith_action(p_action) then
    return faith_refusal(p_world, p_uid, p_action, p_target);
  end if;
  -- Then the ones asked of a beast, which is not at a
  -- tile, and half of a cart, which is furniture and would otherwise be handed
  -- to the code that lights fires. Both answer for their own reach.
  if ride_action(p_action) then
    return ride_refusal(p_world, p_uid, p_action, p_target);
  end if;
  if hands_action(p_action) then
    return hands_refusal(p_world, p_uid, p_action, p_target);
  end if;
  -- Before the one that lights fires, which is what pointing at furniture has
  -- meant up to now: a barrel is furniture too, and tipping it out is not a fire.
  if liquid_action(p_action) then
    return liquid_refusal(p_world, p_uid, p_action, p_target);
  end if;
  -- Also before the one that lights fires: an oven is furniture and an anvil
  -- is pointed at the same way a kiln is, and neither wants that route.
  if forge_action(p_action) then
    return forge_refusal(p_world, p_uid, p_action, p_target);
  end if;
  if holding_action(p_action) then
    return holding_refusal(p_world, p_uid, p_action, p_target);
  end if;
  -- The token is under your feet and a post answers for its own reach, so
  -- neither wants the reach check below.
  if settlement_action(p_action) then
    return settlement_refusal(p_world, p_uid, p_action, p_target);
  end if;
  if dig_action(p_action) then
    return dig_refusal(p_world, p_uid, p_action, p_target);
  end if;
  -- A trap answers for its own reach, and rolls itself forward before it
  -- answers anything at all.
  if trap_action(p_action) then
    return trap_refusal(p_world, p_uid, p_action, p_target);
  end if;
  -- Working the ground answers for its own reach for the same reason: a
  -- corner is a place rather than a thing, and `drop_dirt` names one.
  if ground_action(p_action) then
    if not in_reach(p.x, p.y, p_target, d.corner, d.range) then return 'You are too far away from that.'; end if;
    if d.tool is not null and tool_ql(p_world, p_uid, d.tool) <= 0 then
      return 'You need a ' || lower((select coalesce(name, d.tool) from item_def where id = d.tool)) || ' to ' || lower(d.label) || '.';
    end if;
    return ground_refusal(p_world, p_uid, p_action, p_target);
  end if;
  /*
   * A furnace is brought up to date before anything asks it a question: its
   * fire and its queue together, so that "is anything finished" is answered
   * about now rather than about whenever somebody last stood here.
   */
  if aimed in ('smelter', 'kiln') then
    perform furnace_settle(p_world, nullif(p_target->>'id', '')::bigint);
  end if;
  if item_action(p_action) then
    return item_refusal(p_world, p_uid, p_action, p_target);
  end if;
  if firing_action(p_action) then
    return firing_refusal(p_world, p_uid, p_action, p_target);
  end if;
  if aimed in ('campfire', 'smelter', 'kiln', 'furniture', 'anvil') or fire_action(p_action) then
    return fire_refusal(p_world, p_uid, p_action, p_target);
  end if;
  -- A crate is reached for rather than stood in front of, so it answers for
  -- its own reach the way the creatures do.
  if crate_action(p_action) then
    return crate_refusal(p_world, p_uid, p_action, p_target);
  end if;
  -- Fitting a padlock and taking one off: aimed at a crate or at a piece of
  -- furniture, so it sits beside the family that answers for crates.
  if p_action in ('fit_lock', 'take_off_lock') then
    return lock_refusal_for(p_world, p_uid, p_action, p_target);
  end if;
  -- The stake is in your hand and the ground is under your feet: nothing to reach for.
  if p_action = 'found_settlement' then
    return deed_refusal(p_world, p_uid, p_action, p_target);
  end if;
  -- A creature is not at a tile, it is wherever its last leg left it, so the
  -- reach check below cannot answer for it. Both of these do their own; the
  -- fighting ones reach as far as what is in your hand, which is further.
  if creature_action(p_action) then
    return creature_refusal(p_world, p_uid, p_action, p_target);
  end if;
  if fight_action(p_action) then
    return fight_refusal(p_world, p_uid, p_action, p_target);
  end if;
  if not in_reach(p.x, p.y, p_target, d.corner, d.range) then return 'You are too far away from that.'; end if;
  if d.tool is not null and tool_ql(p_world, p_uid, d.tool) <= 0 then
    return 'You need a ' || lower((select coalesce(name, d.tool) from item_def where id = d.tool)) || ' to ' || lower(d.label) || '.';
  end if;
  if foundation_action(p_action) then
    return foundation_refusal(p_world, p_uid, p_action, p_target);
  end if;
  if build_action(p_action) then
    return build_refusal(p_world, p_uid, p_action, p_target);
  end if;
  if p_action in ('mine', 'chip_corner', 'pack', 'cultivate', 'pave_cobble', 'drop_dirt_here') then
    return terrain_refusal(p_world, p_uid, p_action, p_target);
  end if;
  if p_action in ('cut_down', 'forage', 'botanize', 'collect') then
    return gather_refusal(p_world, p_uid, p_action, p_target);
  end if;
  if p_action in ('till', 'plant_seed', 'tend_crop', 'harvest_crop', 'clear_field') then
    return farm_refusal(p_world, p_uid, p_action, p_target);
  end if;
  if p_action in ('fish', 'drag_net') then
    return fish_refusal(p_world, p_uid, p_action, p_target);
  end if;

  if exists (select 1 from recipe where id = p_action) then
    return craft_refusal(p_world, p_uid, p_action, target_item(p_target));
  end if;

  if p_action = 'dig' then
    cx := (p_target->>'cx')::int; cy := (p_target->>'cy')::int;
    tx := (p_target->>'x')::int;  ty := (p_target->>'y')::int;
    select * into t from tile_def where id = land_tile(p_world, tx, ty);
    if t.dig_yield is null then return 'You cannot dig that.'; end if;
    /*
     * The same depth a pick works to. This was the exact line `terrain_refusal`
     * condemns in its own comment — `<= 0` refuses a corner standing at the
     * waterline, where no water is drawn — and mining was fixed for it while
     * digging was left with it.
     */
    if land_height(p_world, cx, cy) < -mine_depth() then
      return 'The water is too deep here to work in.';
    end if;
    if land_dirt(p_world, cx, cy) <= 0 then
      return 'That corner is bare rock. Only a pickaxe will take it lower.';
    end if;
    return coalesce(level_stop(p_world, p_uid, cx, cy, -1),
                    slope_refusal(p_world, p_uid, 'digging', cx, cy, -1));
  end if;
  return null;
end $function$;

CREATE OR REPLACE FUNCTION public.fire_refusal(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
AS $function$
declare p placed; it item; n int; sub text; sz int[];
begin
  -- Opening a creature crate, which is furniture standing on the ground.
  if p_action in ('crate_follow', 'crate_work') then
    return crate_open_refusal(p_world, p_uid, p_action, p_target);
  end if;
  if p_action = 'build_campfire' then
    if p_target->>'sx' is null or p_target->>'sy' is null then return 'Choose a spot.'; end if;
    if pack_count(p_world, p_uid, 'shaft') < 2 then return 'A campfire takes 2 shafts.'; end if;
    return null;
  end if;

  if p_action in ('place_smelter', 'place_furniture', 'place_kiln') then
    select * into it from item
      where id = target_item(p_target) and world_id = p_world
        and holder = 'player' and holder_uid = p_uid;
    if not found then return 'You are not carrying that.'; end if;
    if p_action = 'place_smelter' and it.def <> 'smelter' then return 'That is not a smelter.'; end if;
    if p_action = 'place_kiln' and it.def <> 'kiln' then return 'That is not a kiln.'; end if;
    if p_action = 'place_furniture' then
      sub := replace(it.def, 'furniture_', '');
      if not exists (select 1 from furniture_def where id = sub) then return 'That is not something you can set down.'; end if;
    end if;
    -- And the block of spots it would take, which used to be the browser's to refuse alone.
    sz := placed_size(case p_action when 'place_smelter' then 'smelter' when 'place_kiln' then 'kiln' else 'furniture' end, sub,
                      case when p_target->>'facing' in ('n', 'e', 's', 'w') then p_target->>'facing' else 's' end);
    if block_taken(p_world, (p_target->>'x')::int, (p_target->>'y')::int,
                   least(subtiles() - sz[1], greatest(0, coalesce((p_target->>'sx')::int, 0))),
                   least(subtiles() - sz[2], greatest(0, coalesce((p_target->>'sy')::int, 0))), sz[1], sz[2]) then
      return 'Something is already standing there.';
    end if;
    return null;
  end if;

  p := target_placed(p_world, p_target);
  if p.id is null then return 'It is gone.'; end if;
  if not placed_in_reach(p_world, p_uid, p.id) then
    return 'Stand next to the ' || coalesce(p.sub, p.kind) || '.';
  end if;

  if p_action in ('light_campfire', 'light_smelter', 'light_kiln') then
    if placed_lit(p) then return 'It is already burning.'; end if;
    if placed_fuel(p) <= 0 then return 'There is nothing left to burn. Feed it some wood.'; end if;
  elsif p_action in ('put_out_campfire', 'damp_smelter', 'damp_kiln') then
    if not placed_lit(p) then return 'It is not burning.'; end if;
  elsif p_action in ('fuel_campfire', 'fuel_smelter', 'fuel_kiln') then
    -- From what is at hand: the pack, a bag, or a store within reach.
    select i.* into it from craft_stock(p_world, p_uid, target_item(p_target)) s join item i on i.id = s.id
      where (s.id = target_item(p_target) or fuel_value(s.def) is not null)
      order by (s.id = target_item(p_target)) desc, s.draw limit 1;
    if not found or fuel_value(it.def) is null then
      return 'Fires take ' || fuel_said() || '.';
    end if;
    if placed_fuel(p) >= fire_capacity() then return 'It is already piled as high as it will take.'; end if;
  elsif p_action in ('take_ashes_fire', 'take_ashes_smelter', 'take_ashes_kiln') then
    if floor(placed_ash(p)) < 1 then return 'There are no ashes worth taking yet.'; end if;
  elsif p_action = 'turn_furniture' then
    if p.kind <> 'furniture' then return 'Only furniture turns.'; end if;
    if placed_lit(p) then return 'Put it out first.'; end if;
    if p.puller is not null then return 'Let go of it first.'; end if;
    if p.driver is not null then return 'Get down off it first.'; end if;
    if crates_on_rack(p_world, p.id) > 0 then return 'Take the crates off it first.'; end if;
    return furniture_turn_reason(p);
  elsif p_action in ('take_apart_campfire', 'pick_up_smelter', 'pick_up_furniture', 'pick_up_kiln') then
    if placed_lit(p) then return 'Put it out first.'; end if;
    if p_action = 'pick_up_furniture' then
      -- What is inside it, and what is in front of it.
      if exists (select 1 from item i where i.holder = 'furniture' and i.placed = p.id) then
        return 'Empty it first.';
      end if;
      -- A rack holds nothing of its own, so the check above passes however
      -- loaded it is: what stands on it are crates of somebody else's, and
      -- lifting the rack out from under them would leave them in the air.
      if crates_on_rack(p_world, p.id) > 0 then
        return 'Take the ' || case when crates_on_rack(p_world, p.id) = 1 then 'crate'
                                   else crates_on_rack(p_world, p.id) || ' crates' end || ' off it first.';
      end if;
      if placed_litres(p) > 0 then return 'Empty it out first.'; end if;
      -- A crate with somebody else's wildermon in it is theirs to carry off.
      if p.creature is not null and exists (select 1 from creature q where q.world_id = p_world
            and q.id = p.creature and q.mode = 'stored' and q.keeper is distinct from p_uid) then
        return (select q.name from creature q where q.world_id = p_world and q.id = p.creature)
          || ' is not yours to carry off.';
      end if;
      if p.puller is not null then return 'Let go of it first.'; end if;
      if team_size(p_world, p.id) > 0 then return 'Unhitch the team first.'; end if;
      if p.driver is not null then return 'Get down off it first.'; end if;
    end if;
  end if;
  return null;
end $function$;

CREATE OR REPLACE FUNCTION public.perform_fire(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare p placed; it item; sz int[]; ax int; ay int; per double precision; room double precision;
        fits int; whole int; sub text; made bigint; back text;
begin
  if p_action = 'build_campfire' then
    ax := least(subtiles() - 2, greatest(0, (p_target->>'sx')::int));
    ay := least(subtiles() - 2, greatest(0, (p_target->>'sy')::int));
    if not consume(p_world, p_uid, 'shaft', 2) then return; end if;
    insert into placed (world_id, kind, x, y, sx, sy, cx, cy, fuel, made_by)
    values (p_world, 'campfire', (p_target->>'x')::int, (p_target->>'y')::int, ax, ay,
            (p_target->>'x')::int + (ax + 1.0) / subtiles(), (p_target->>'y')::int + (ay + 1.0) / subtiles(),
            120, p_uid);
    perform tell(p_world, p_uid, 'You lay a campfire from 2 shafts. Light it, or feed it more wood first.', 'event');
    perform land_announce(p_world, (p_target->>'x')::int, (p_target->>'y')::int);
    return;
  end if;

  if p_action in ('place_smelter', 'place_furniture', 'place_kiln') then
    select * into it from item where id = target_item(p_target);
    -- A piece stands there as whatever it was in the pack. This read the def
    -- through replace(it.def, 'furniture_', '') for as long as the pick-up put
    -- that prefix on, which meant the two halves disagreed about what an item
    -- is called and only one of them ever said so. Neither does now.
    sub := case when p_action = 'place_furniture' then it.def end;
    -- Which way it faces, which is the browser's to say and south when it says nothing.
    back := case when p_target->>'facing' in ('n', 'e', 's', 'w') then p_target->>'facing' else 's' end;
    sz := placed_size(case p_action when 'place_smelter' then 'smelter'
                                    when 'place_kiln' then 'kiln' else 'furniture' end, sub, back);
    ax := least(subtiles() - sz[1], greatest(0, coalesce((p_target->>'sx')::int, 0)));
    ay := least(subtiles() - sz[2], greatest(0, coalesce((p_target->>'sy')::int, 0)));
    /*
     * The quality, and -- new here -- the rarity and the wood.
     *
     * A piece set down used to reach the ground with nothing but its quality.
     * Its rarity went in the bin, so a rare chest was a rare chest right up
     * until somebody put it in a room and then it was a chest; and its wood
     * went with it, so an oak chest and a pine one were the same chest the
     * moment they were standing. Both are on the item being consumed here,
     * and both come across now.
     */
    insert into placed (world_id, kind, sub, x, y, sx, sy, cx, cy, ql, made_by, facing, rare, material, creature)
    values (p_world, case p_action when 'place_smelter' then 'smelter'
                                   when 'place_kiln' then 'kiln' else 'furniture' end, sub,
            (p_target->>'x')::int, (p_target->>'y')::int, ax, ay,
            (p_target->>'x')::int + (ax + sz[1] / 2.0) / subtiles(),
            (p_target->>'y')::int + (ay + sz[2] / 2.0) / subtiles(),
            it.ql, p_uid, back, it.rare, it.extra,
            case when p_action = 'place_furniture' then it.creature end)
    returning id into made;
    delete from item where id = it.id;
    -- And whoever is shut in it stands where it stands, and is seen in it.
    if p_action = 'place_furniture' and it.creature is not null then
      update creature c set from_x = pl.cx, from_y = pl.cy, to_x = pl.cx, to_y = pl.cy,
          leg_at = now(), leg_ends = now(), until = now(), settled_at = now()
        from placed pl where pl.id = made and c.world_id = p_world and c.id = it.creature;
    end if;
    perform tell(p_world, p_uid, 'You set the ' ||
      lower(coalesce((select name from furniture_def where id = sub),
        case when p_action = 'place_kiln' then 'kiln' else 'smelter' end)) || ' down'
      || coalesce(' with ' || (select c.name from creature c where p_action = 'place_furniture'
                                 and c.world_id = p_world and c.id = it.creature) || ' in it', '')
      || '.', 'event');
    perform land_announce(p_world, (p_target->>'x')::int, (p_target->>'y')::int);
    return;
  end if;

  perform placed_settle(nullif(p_target->>'id', '')::bigint);
  p := target_placed(p_world, p_target);
  if p.id is null then return; end if;

  if p_action in ('light_campfire', 'light_smelter', 'light_kiln') then
    update placed set lit = true, since = now() where id = p.id;
    if p_action = 'light_campfire' then perform journal_note(p_world, p_uid, 'fire'); end if;
    perform tell(p_world, p_uid, 'The kindling catches and the ' || p.kind || ' burns. It has '
      || burns_for(p.fuel) || ' of fuel.', 'event');
  elsif p_action in ('put_out_campfire', 'damp_smelter', 'damp_kiln') then
    update placed set lit = false, since = now() where id = p.id;
    perform tell(p_world, p_uid, 'You smother the fire. The wood is saved for later.', 'event');
  elsif p_action in ('fuel_campfire', 'fuel_smelter', 'fuel_kiln') then
    -- From what is at hand: the pack, a bag, or a store within reach.
    select i.* into it from craft_stock(p_world, p_uid, target_item(p_target)) s join item i on i.id = s.id
      where (s.id = target_item(p_target) or fuel_value(s.def) is not null)
      order by (s.id = target_item(p_target)) desc, s.draw limit 1;
    per := fuel_value(it.def);
    room := greatest(0, fire_capacity() - p.fuel);
    /*
     * How many you asked for, which this never read.
     *
     * Reported as "attempting to feed one coal to a smelter puts four coal
     * in". The menu offers one or all and sends the count either way; this
     * fed as much as would fit whatever it was told, so a firebox with room
     * in it swallowed the whole pile on a single "one". The browser has read
     * the count since fuelling was written.
     */
    fits := greatest(1, least(least(coalesce((p_target->>'count')::int, 1), it.count),
                              ceil(room / per)::int));
    if not spend_stack(p_world, p_uid, it.id, fits) then return; end if;
    update placed set fuel = least(fire_capacity(), p.fuel + per * fits), since = now() where id = p.id;
    perform tell(p_world, p_uid, 'You feed ' || case when fits > 1 then fits || ' × ' else 'a ' end
      || lower((select name from item_def where id = it.def)) || ' to the fire. '
      || burns_for(least(fire_capacity(), p.fuel + per * fits)) || ' of fuel.', 'event');
  elsif p_action in ('take_ashes_fire', 'take_ashes_smelter', 'take_ashes_kiln') then
    whole := floor(p.ash)::int;
    update placed set ash = p.ash - whole, since = now() where id = p.id;
    perform give(p_world, p_uid, 'ash', whole, 20);
    perform tell(p_world, p_uid, 'You rake ' || whole || case when whole = 1 then ' lot' else ' lots' end
      || ' of ashes out of the ' || p.kind || '. (QL 20)', 'event');
  elsif p_action = 'take_apart_campfire' then
    -- Coal burns but is never got back, so a pile of logs cannot be turned
    -- into coal by rebuilding the fire.
    delete from placed where id = p.id;
    perform give(p_world, p_uid, 'shaft', 2, 20);
    perform tell(p_world, p_uid, 'You take the campfire apart and save what will burn again.', 'event');
    perform land_announce(p_world, p.x, p.y);
  elsif p_action = 'turn_furniture' then
    -- A quarter turn to the right, walked to the nearest spot the turned block fits.
    back := turned_facing(p.facing, 1);
    sz := placed_size(p.kind, p.sub, back);
    ax := least(subtiles() - sz[1], greatest(0, p.sx));
    ay := least(subtiles() - sz[2], greatest(0, p.sy));
    update placed set facing = back, sx = ax, sy = ay,
        cx = p.x + (ax + sz[1] / 2.0) / subtiles(), cy = p.y + (ay + sz[2] / 2.0) / subtiles()
      where id = p.id;
    perform tell(p_world, p_uid, 'You turn the ' || lower(placed_name(p)) || ' to face ' || side_name(back) || '.', 'event');
    perform land_announce(p_world, p.x, p.y);

  elsif p_action in ('pick_up_smelter', 'pick_up_furniture', 'pick_up_kiln') then
    /*
     * What goes back in the pack is the thing's own definition, which for a
     * piece of furniture is its `sub` and nothing else.
     *
     * It used to be 'furniture_' || p.sub. There is no such item: the
     * catalogue calls a wagon a wagon, so picking one up put a row in your
     * pack with a definition nothing has ever heard of. It showed as its own
     * id under OTHER, weighed whatever the fallback weighs, and could not be
     * set down again, because the browser asks `isFurniture` of the id it is
     * holding and the answer was no. The wagon was not lost, but it was not a
     * wagon either.
     *
     * The other half of the pair hid it: `place_furniture` reads its `sub`
     * with replace(it.def, 'furniture_', ''), so it would have accepted the
     * broken id perfectly well and nothing on this side ever complained.
     */
    back := case p.kind when 'smelter' then 'smelter' when 'kiln' then 'kiln'
                        else p.sub end;
    -- And back the same way: what it stood there as is what goes in the pack.
    -- `give` has taken a material and a rarity since the day it was written.
    -- Given before the piece comes up, so a crate's wildermon is never in no crate at all.
    made := give(p_world, p_uid, back, 1, p.ql, p.material, p.rare);
    if p.creature is not null then
      update item set creature = p.creature where id = made;
      update creature c set from_x = py.x, from_y = py.y, to_x = py.x, to_y = py.y,
          leg_at = now(), leg_ends = now(), until = now(), settled_at = now()
        from player py where py.world_id = p_world and py.uid = p_uid
          and c.world_id = p_world and c.id = p.creature;
    end if;
    delete from placed where id = p.id;
    perform tell(p_world, p_uid, 'You take up the '
      || lower(coalesce((select name from furniture_def where id = p.sub), p.sub, p.kind))
      || coalesce(' with ' || (select c.name from creature c where c.world_id = p_world and c.id = p.creature) || ' in it', '')
      || '.', 'event');
    perform land_announce(p_world, p.x, p.y);
  end if;
end $function$;

CREATE OR REPLACE FUNCTION public.creature_refusal(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS text
 LANGUAGE plpgsql
AS $function$
declare c creature; d species_def; food text; held int; working int; cap int;
begin
  -- Opening a crate you carry is asked of the crate, not of a creature.
  if p_action in ('crate_follow', 'crate_work') then
    return crate_open_refusal(p_world, p_uid, p_action, p_target);
  end if;
  -- Walked forward before it is looked at: where it was is not where it is.
  perform creature_settle(p_world, (p_target->>'id')::int);
  c := target_creature(p_world, p_target);
  if c.world_id is null then return 'It is gone.'; end if;
  select * into d from species_def where id = c.species;

  -- In the traces until somebody takes it out: nothing that would send it
  -- anywhere else is open to it, in the words culling one already uses.
  if p_action in ('assign_deed', 'take_creature', 'crate_creature', 'release_creature')
     and c.hitched_to is not null then
    return c.name || ' is in the traces. Take it out first.';
  end if;

  -- Only your own is yours to send anywhere, put in a crate, order about or name.
  if p_action in ('take_creature', 'assign_deed', 'crate_creature', 'release_creature', 'cull_creature',
                  'set_stance', 'rename_creature')
     and c.mode <> 'wild' and c.keeper is distinct from p_uid then
    return c.name || ' is not yours.';
  end if;

  if p_action not in ('examine_creature', 'assign_deed')
     and not creature_in_reach(p_world, p_uid, c) then
    return case when c.mode = 'wild' then 'The ' || lower(d.name) || ' is not close enough.'
                else 'Stand next to ' || c.name || '.' end;
  end if;

  if p_action = 'tame' then
    if d.monster then
      return 'A ' || lower(d.name) || ' is not a wildermon. There is nothing to be done with it but kill it.';
    end if;
    if c.mode <> 'wild' then return c.name || ' is already yours.'; end if;
    if skill_of(p_world, p_uid, 'taming') < d.tame_level then
      return 'You need taming ' || to_char(d.tame_level, 'FM990.#') || ' to try.';
    end if;
    if bait_in_pack(p_world, p_uid, c.species) is null then
      return d.name || 's take ' || diet_text(c.species) || '. Bring some.';
    end if;
    -- The first follows you, and every one after that goes into a crate you carry.
    return tame_room_refusal(p_world, p_uid);

  elsif p_action = 'assign_deed' then
    if c.mode = 'wild' then return 'It is not yours to set to work.'; end if;
    if c.mode = 'stored' then return c.name || ' is in a creature crate. Open the crate to set it to work.'; end if;
    if (my_deed(p_world, p_uid)).world_id is null then
      return 'You have no settlement to assign it to.';
    end if;
    if d.gathers is null then return 'A ' || lower(d.name) || ' has no trade to be set to.'; end if;
    -- A trade asked for by name has to be one of its own.
    if nullif(p_target->>'job', '') is not null
       and not (p_target->>'job' = d.gathers or p_target->>'job' = any(coalesce(d.trades, '{}'::text[]))) then
      return 'A ' || lower(d.name) || ' cannot be set to that.';
    end if;
    if not worker_job_ported(coalesce(nullif(p_target->>'job', ''), d.gathers)) then
      return 'Nobody has taught this island what '
        || (select plain from gather_def where id = coalesce(nullif(p_target->>'job', ''), d.gathers))
        || ' looks like yet.';
    end if;
    -- Only a grown one works, and so only a grown one takes a place.
    if (c.mode <> 'deed' or c.post is not null) and (age_row(c.born)).works then
      working := workers_on_deed(p_world, p_uid);
      cap := worker_cap(p_world, p_uid);
      if working >= cap then
        return (my_deed(p_world, p_uid)).name || ' has work for ' || cap
          || ' wildermon at level ' || cap || '. Upgrade the settlement to take on more.';
      end if;
    end if;
    return null;

  elsif p_action = 'feed' then
    if c.mode not in ('active', 'deed') then return 'It is not yours to feed.'; end if;
    if bait_in_pack(p_world, p_uid, c.species) is null then
      return 'It eats ' || diet_text(c.species) || '.';
    end if;
    return null;

  elsif p_action = 'groom' then
    if d.monster then return 'Not that. Not ever.'; end if;
    if c.mode = 'wild' then return 'It is not yours to brush.'; end if;
    if pack_count(p_world, p_uid, 'brush') <= 0 then return 'You need a brush.'; end if;
    if c.care >= 0.995 then return c.name || ' has been brushed to a shine already.'; end if;
    return null;

  elsif p_action = 'shear' then
    if d.fleece is null then return 'There is nothing on it worth shearing.'; end if;
    if c.mode = 'wild' then return 'Tame it first; it will not stand still for you otherwise.'; end if;
    if pack_count(p_world, p_uid, 'carving_knife') <= 0 then return 'You need a knife to shear with.'; end if;
    if c.fleece < 0.35 then
      return c.name || ' has hardly any '
        || case when d.shear_yield = 'feather' then 'feathers' else 'fleece' end || ' back yet.';
    end if;
    return null;

  elsif p_action = 'milk_creature' then
    if not d.milk then return 'That is not something you milk.'; end if;
    if c.mode in ('wild', 'stored') then return 'It is not yours to milk.'; end if;
    if pack_count(p_world, p_uid, 'bucket') <= 0 then return 'You need an empty bucket.'; end if;
    if c.sex <> 'female' then return c.name || ' is male. Nothing is coming out of him.'; end if;
    if c.fleece < 0.4 then return c.name || ' has nothing to give yet.'; end if;
    return null;

  elsif p_action = 'set_stance' then
    if c.mode <> 'active' then return 'Only a companion takes orders like that.'; end if;
    if coalesce(p_target->>'stance', '') not in ('passive', 'defensive', 'aggressive') then
      return 'Passive, defensive or aggressive.';
    end if;
    return null;

  elsif p_action = 'rename_creature' then
    if c.mode = 'wild' then return 'It is not yours to name.'; end if;
    if nullif(btrim(coalesce(p_target->>'name', '')), '') is null then return 'Choose a name.'; end if;
    return null;

  elsif p_action = 'take_creature' then
    if c.mode = 'stored' then return c.name || ' is in a creature crate. Open the crate to let it out.'; end if;
    if c.mode <> 'deed' then return 'It is already with you.'; end if;
    -- Where the one following you now goes, or why it has nowhere to.
    return (companion_swap(p_world, p_uid, c)).v_why;

  elsif p_action = 'crate_creature' then
    if c.mode = 'stored' then return c.name || ' is already in a creature crate.'; end if;
    if c.mode not in ('active', 'deed') then return 'It is not yours to put in a crate.'; end if;
    if c.rider is not null then return 'Get down off ' || c.name || ' first.'; end if;
    if empty_crate(p_world, p_uid) is null then return 'You need an empty creature crate in your pack.'; end if;
    return null;

  elsif p_action = 'release_creature' then
    if c.mode = 'wild' then return 'It is already wild.'; end if;
    return null;

  elsif p_action = 'cull_creature' then
    -- Only your own, and only one that is not in the traces or under you when
    -- you ask: both of those are a mess this does not have to make.
    if c.mode = 'wild' then return 'That one is nobody''s. Fight it if you mean it.'; end if;
    if c.hitched_to is not null then return c.name || ' is in the traces. Take it out first.'; end if;
    if c.rider is not null then return 'Get down off ' || c.name || ' first.'; end if;
    return null;
  end if;
  return null;
end $function$;

CREATE OR REPLACE FUNCTION public.perform_creature(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare c creature; d species_def; a age_def; food text; n int; made_ql double precision;
        gained double precision; chance double precision; warm double precision; nm text;
        held int; brush_id bigint; top double precision; before double precision; skill double precision;
        dd deed; v_swap int; v_to text; v_why text;
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
      perform tell(p_world, p_uid, case when (age_row(c.born)).works
          then c.name || ' stays behind in its place, and will ' || deed_job_line(c) || '.'
          else c.name || ' stays behind in its place. It is not grown, and stays about the settlement until it is.' end,
        'info');
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

CREATE OR REPLACE FUNCTION public.give_birth(p_world uuid, p_id integer)
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
/*
 * Every local prefixed, and the ninth and tenth times this class has bitten
 * were both in this one function: `born` is a column of `creature` and so is
 * `traits`, and an unprefixed local of either name inside `update creature` is
 * not a local at all. The rule is not "prefix the ones that have bitten", it
 * is "prefix all of them", and it has to be applied while writing rather than
 * while debugging.
 */
declare v_dam creature; v_d species_def; v_nx double precision; v_ny double precision;
        v_born int; v_coming jsonb; v_traits text[]; v_home record;
        v_dd deed; v_mode text; v_where text := ''; v_crate bigint;
begin
  select * into v_dam from creature where world_id = p_world and id = p_id for update;
  if not found or v_dam.due is null or v_dam.due > now() then return 0; end if;
  v_coming := v_dam.unborn;
  update creature set unborn = null, due = null where world_id = p_world and id = p_id;
  if v_coming is null then return 0; end if;
  select * into v_d from species_def where id = v_dam.species;
  v_nx := creature_x(v_dam); v_ny := creature_y(v_dam);
  /*
   * Where it goes, now that nothing is kept at the token -- and with its
   * keeper's name on it, which a young one born at the token never had.
   *
   * A dam that is nobody's drops a wild one. Otherwise it joins the herd of
   * its keeper's settlement, beside its dam when she is out and at the token
   * when she is shut in a crate, and is not put to work until it is grown.
   * Without a settlement it follows its keeper when nothing else does, and
   * goes into an empty creature crate they carry when something does. With
   * none of those it goes off into the wild.
   */
  v_mode := 'wild';
  if v_dam.keeper is not null and v_dam.mode <> 'wild' then
    v_dd := my_deed(p_world, v_dam.keeper);
    if v_dd.world_id is not null then
      v_mode := 'deed';
      if v_dam.mode = 'stored' then v_nx := v_dd.x + 0.5; v_ny := v_dd.y + 1.5; end if;
      v_where := ' It joins the herd of ' || v_dd.name || ', and is put to work when it is grown.';
    elsif companion_of(p_world, v_dam.keeper) is null then
      v_mode := 'active';
      select py.x, py.y into v_home from player py where py.world_id = p_world and py.uid = v_dam.keeper;
      if found then v_nx := v_home.x; v_ny := v_home.y; end if;
      v_where := ' It follows you.';
    else
      v_crate := empty_crate(p_world, v_dam.keeper);
      if v_crate is not null then
        v_mode := 'stored';
        v_where := ' It goes into the creature crate in your pack.';
      else
        v_where := ' You have no settlement, something already follows you and you carry no empty creature crate, so it goes off into the wild.';
      end if;
    end if;
  end if;
  v_born := creature_spawn(p_world, v_dam.species, v_nx, v_ny,
    case when v_mode = 'stored' then 'active' else v_mode end, now(),
    case when v_mode = 'wild' then null else v_dam.keeper end);
  select array_agg(t) into v_traits from jsonb_array_elements_text(v_coming->'traits') t;
  update creature set traits = coalesce(v_traits, '{}'), sex = v_coming->>'sex',
      hunger = 0.9, care = 0.5
    where world_id = p_world and id = v_born;
  update creature c set health = max_health(c) where c.world_id = p_world and c.id = v_born;
  if v_mode = 'stored' then perform crate_shut_in(p_world, v_born, v_crate, null); end if;
  if v_dam.keeper is not null then
    perform journal_note(p_world, v_dam.keeper, 'bred');
    -- Blood worth keeping, which is the whole point of putting two together.
    if exists (select 1 from unnest(coalesce(v_traits, '{}')) t
               join trait_def td on td.id = t where td.tier in ('supreme', 'fantastic')) then
      perform journal_note(p_world, v_dam.keeper, 'goodblood');
    end if;
    perform tell(p_world, v_dam.keeper, v_dam.name || ' drops a young ' || lower(v_d.name)
      || ' (' || (v_coming->>'sex') || '): ' || trait_names(coalesce(v_traits, '{}'))
      || '.' || v_where, 'event');
  end if;
  return v_born;
end $function$;

CREATE OR REPLACE FUNCTION public.worker_settle(p_world uuid, p_id integer)
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
declare c creature; d species_def; kind text; guard int := 0; done int := 0;
        spot record; stand record; step record; pace double precision; dist double precision;
        secs double precision; load jsonb; cx double precision; cy double precision;
        ax double precision; ay double precision; v_foe creature; v_corpse item;
        v_step record; v_site record; v_store record; v_in boolean;
begin
  select * into c from creature where world_id = p_world and id = p_id for update;
  if not found or c.mode <> 'deed' then return 0; end if;
  /*
   * Where it takes its orders from. A post stands in for a settlement, and a
   * worker with neither has nobody to take them from at all.
   */
  select * into v_site from work_site(p_world, c);
  if v_site.x is null then
    /*
     * Let go, and told.
     *
     * A worker with neither a post nor a settlement to take orders from is
     * turned loose — which is right, because the cap on how many you may keep
     * is your settlement's level and it is nought without one. What was wrong
     * was doing it in silence. From the island: a wildermon that had been
     * working stood about on fifty tiles of forage it could have been on, and
     * nothing anywhere said it had stopped being a worker. The rules were
     * doing exactly as written and the only broken thing was that nobody was
     * told.
     */
    update creature set mode = 'wild', phase = 'idle', job = null, post = null
      where world_id = p_world and id = p_id;
    if c.keeper is not null then
      perform tell(p_world, c.keeper,
        c.name || ' has no settlement to work for and has gone back to its own business.', 'event');
    end if;
    return 0;
  end if;
  select * into d from species_def where id = c.species;
  -- The trade it was set to, which is its species' own unless it was told otherwise.
  -- Nothing that young is put to work: it keeps about the settlement until it is grown.
  kind := case when (age_row(c.born)).works then coalesce(c.job, d.gathers) end;
  pace := d.speed * (age_row(c.born)).speed * beast_mul(c, 'speed')
          * (1 + greatest(1, task_skill(c)) / 500);
  if kind is null then
    -- One leg at a time about the token or the post, and a rest after each.
    if c.until <= now() then
      ax := v_site.x + 0.5 + (hash_tile(p_id, c.leg + 1, 601) * 2 - 1) * 3;
      ay := v_site.y + 0.5 + (hash_tile(p_id, c.leg + 1, 701) * 2 - 1) * 3;
      if not creature_tile_ok(p_world, floor(ax)::int, floor(ay)::int) then ax := c.to_x; ay := c.to_y; end if;
      secs := greatest(0.2, sqrt((ax - c.to_x) ^ 2 + (ay - c.to_y) ^ 2) / greatest(0.1, pace));
      update creature set from_x = to_x, from_y = to_y, to_x = ax, to_y = ay, leg = leg + 1, phase = 'idle',
          leg_at = now(), leg_ends = now() + make_interval(secs => secs),
          until = now() + make_interval(secs => secs + 4), settled_at = now()
        where world_id = p_world and id = p_id;
    end if;
    return 0;
  end if;

  while c.until <= now() and guard < 120 loop
    guard := guard + 1;
    cx := c.to_x; cy := c.to_y;

    /*
     * Company first.
     *
     * Nothing works while something is coming at it, and the two trades that
     * fight for a living are always looking for company. A worker breaks off
     * between jobs rather than mid-load: what is already in its arms goes in
     * the crate before it goes for anything, which is the one place this is
     * tidier than the browser.
     */
    if c.phase = 'strike' then
      update creature set from_x = c.from_x, from_y = c.from_y, to_x = c.to_x, to_y = c.to_y,
          leg_at = c.leg_at, leg_ends = c.leg_ends, until = c.until, phase = c.phase,
          work_x = c.work_x, work_y = c.work_y, carrying = c.carrying, enemy = c.enemy,
          settled_at = now()
        where world_id = p_world and id = p_id;
      if c.enemy is not null and creature_attack(p_world, p_id, c.enemy) then done := done + 1; end if;
      select * into c from creature where world_id = p_world and id = p_id;
      c.phase := 'idle';
      c.leg_at := c.until; c.leg_ends := c.until;
      continue;

    elsif c.phase = 'stalk' then
      -- Arrived where the carcass went down. If somebody else has had it, the
      -- walk was wasted, which is what happens to a hunter now and then.
      c.carrying := take_from_ground(p_world, c.work_x, c.work_y, 'corpse');
      c.work_x := null; c.work_y := null;
      c.phase := 'idle';
      c.leg_at := c.until; c.leg_ends := c.until;
      c.until := c.until + interval '0.5 seconds';
      continue;
    end if;

    if fight_trade(kind) and c.phase = 'idle' and c.carrying is not null then
      select * into v_store from worker_store(p_world, c, c.carrying->>'def', (c.carrying->>'count')::int);
      if v_store.id is null then
        c.until := now() + interval '30 seconds';
        exit;
      end if;
      ax := v_store.cx; ay := v_store.cy;
      dist := sqrt((ax - cx) ^ 2 + (ay - cy) ^ 2);
      c.from_x := cx; c.from_y := cy; c.to_x := ax; c.to_y := ay;
      c.leg_at := c.until;
      c.leg_ends := c.leg_at + make_interval(secs => greatest(0.2, dist / greatest(0.1, pace)));
      c.until := c.leg_ends;
      c.phase := 'home';
      continue;
    end if;

    if c.phase = 'idle' and c.carrying is null
       and (fight_trade(kind) or c.enemy is not null or c.stance <> 'passive') then
      v_foe := fight_target(p_world, p_id);
      if v_foe.id is null then
        c.enemy := null;
      else
        if c.enemy is distinct from v_foe.id then
          -- It has just seen it. A guard trains its back by keeping watch; a
          -- hunter learns the country by hunting it.
          if fight_trade(kind) then
            perform worker_learn(p_world, p_id,
              case when kind = 'hunt' then 'fighting' else 'body_strength' end,
              case when kind = 'hunt' then 0.08 else 0.1 end);
          end if;
          c.enemy := v_foe.id;
        end if;
        ax := creature_x(v_foe); ay := creature_y(v_foe);
        dist := sqrt((ax - cx) ^ 2 + (ay - cy) ^ 2);
        if dist <= fight_reach(kind) then
          c.phase := 'strike';
          c.leg_at := c.until; c.leg_ends := c.until;
          c.until := c.until + make_interval(secs => fight_blow(kind) / beast_mul(c, 'haste'));
        else
          select * into v_step from chase_leg(p_world, cx, cy,
            cx + (ax - cx) * (dist - 1) / dist, cy + (ay - cy) * (dist - 1) / dist);
          if v_step.x is null then
            -- Nothing open at all: the browser gives up here too.
            c.enemy := null;
            c.until := c.until + interval '2 seconds';
          else
            c.from_x := cx; c.from_y := cy;
            c.to_x := v_step.x; c.to_y := v_step.y;
            c.leg_at := c.until;
            c.leg_ends := c.leg_at + make_interval(secs =>
              greatest(0.2, sqrt((c.to_x - cx) ^ 2 + (c.to_y - cy) ^ 2)
                            / greatest(0.1, pace * fight_pace(kind))));
            c.until := c.leg_ends;
          end if;
        end if;
        continue;
      end if;
    end if;

    if kind = 'hunt' and c.phase = 'idle' and c.carrying is null then
      if c.work_x is not null and not exists (select 1 from item i
           where i.world_id = p_world and i.holder = 'ground'
             and i.gx = c.work_x and i.gy = c.work_y and i.def = 'corpse') then
        c.work_x := null; c.work_y := null;
      end if;
      if c.work_x is null then
        v_corpse := carcass_near(p_world, v_site.x, v_site.y, v_site.radius, cx, cy);
        if v_corpse.id is not null then c.work_x := v_corpse.gx; c.work_y := v_corpse.gy; end if;
      end if;
      if c.work_x is not null then
        ax := c.work_x + 0.5; ay := c.work_y + 0.5;
        dist := sqrt((ax - cx) ^ 2 + (ay - cy) ^ 2);
        c.from_x := cx; c.from_y := cy; c.to_x := ax; c.to_y := ay;
        c.leg_at := c.until;
        c.leg_ends := c.leg_at + make_interval(secs => greatest(0.2, dist / greatest(0.1, pace)));
        c.until := c.leg_ends;
        c.phase := 'stalk';
        continue;
      end if;
    end if;

    if worker_errand(kind) then
      -- Everything an errand asks about is on the row, so the row goes down
      -- before it is asked.
      update creature set from_x = c.from_x, from_y = c.from_y, to_x = c.to_x, to_y = c.to_y,
          leg_at = c.leg_at, leg_ends = c.leg_ends, until = c.until, phase = c.phase,
          work_x = c.work_x, work_y = c.work_y, carrying = c.carrying, fetching = c.fetching,
          settled_at = now()
        where world_id = p_world and id = p_id;

      if c.phase = 'fetch' then
        load := take_from_stores(p_world, c.fetching);
        if load is null then
          c.phase := 'idle';
          c.leg_at := c.until; c.leg_ends := c.until;
          c.until := now() + interval '4 seconds';
          exit;
        end if;
        c.carrying := load;
        c.fetching := null;
        c.phase := 'idle';
        c.leg_at := c.until; c.leg_ends := c.until;
        c.until := c.until + interval '0.5 seconds';

      elsif c.phase = 'out' then
        c.phase := 'work';
        c.leg_at := c.until; c.leg_ends := c.until;
        c.until := c.until + make_interval(secs => work_duration(task_skill(c)) / beast_mul(c, 'work'));

      elsif c.phase = 'work' then
        if errand_do(p_world, p_id) then done := done + 1; end if;
        select * into c from creature where world_id = p_world and id = p_id;
        c.phase := 'idle';
        c.leg_at := c.until; c.leg_ends := c.until;
        c.until := c.until + interval '1 second';

      else
        select * into step from errand_step(p_world, p_id);
        if step.gx is null then
          -- Nothing to run. Replaying an afternoon of that produces nothing.
          c.from_x := cx; c.from_y := cy;
          c.leg_at := now(); c.leg_ends := now();
          c.until := now() + interval '4 seconds';
          exit;
        end if;
        c.work_x := step.wx; c.work_y := step.wy;
        c.fetching := step.want;
        dist := sqrt((step.gx - cx) ^ 2 + (step.gy - cy) ^ 2);
        c.from_x := cx; c.from_y := cy; c.to_x := step.gx; c.to_y := step.gy;
        c.leg_at := c.until;
        c.leg_ends := c.leg_at + make_interval(secs => greatest(0.2, dist / greatest(0.1, pace)));
        c.until := c.leg_ends;
        c.phase := case when step.want is null then 'out' else 'fetch' end;
      end if;
      continue;
    end if;

    if c.phase = 'out' then
      c.phase := 'work';
      c.leg_at := c.until; c.leg_ends := c.until;
      c.until := c.until + make_interval(secs => work_duration(task_skill(c)) / beast_mul(c, 'work'));

    elsif c.phase = 'work' then
      update creature set from_x = cx, from_y = cy, to_x = cx, to_y = cy,
          leg_at = c.leg_at, leg_ends = c.leg_ends, until = c.until, phase = c.phase,
          work_x = c.work_x, work_y = c.work_y, settled_at = now()
        where world_id = p_world and id = p_id;
      load := worker_do(p_world, p_id);
      select * into c from creature where world_id = p_world and id = p_id;
      done := done + 1;
      c.carrying := load;
      c.work_x := null; c.work_y := null;
      if load is null then
        c.phase := 'idle';
        c.leg_at := c.until; c.leg_ends := c.until;
        c.until := c.until + interval '1 second';
      else
        select * into v_store from worker_store(p_world, c, load->>'def', (load->>'count')::int);
        if v_store.id is null then
          -- Everything on the deed is full. A worker will not tip a load out
          -- on the ground: it holds it and waits for room, and says so, once
          -- in a while rather than once a job.
          perform worker_nowhere(p_world, c);
          c.phase := 'idle';
          c.leg_at := c.until; c.leg_ends := c.until;
          c.until := now() + interval '30 seconds';
          exit;
        end if;
        ax := v_store.cx; ay := v_store.cy;
        dist := sqrt((ax - cx) ^ 2 + (ay - cy) ^ 2);
        secs := greatest(0.2, dist / greatest(0.1, pace));
        c.from_x := cx; c.from_y := cy; c.to_x := ax; c.to_y := ay;
        c.leg_at := c.until; c.leg_ends := c.leg_at + make_interval(secs => secs);
        c.until := c.leg_ends;
        c.phase := 'home';
      end if;

    elsif c.phase = 'home' then
      /*
       * Wherever the room is *now*. A crate that had room when the walk began
       * may be full by the time the load arrives — somebody else filled it, or
       * another worker got there first — and the old rule walked to the
       * settlement's crate, failed quietly into a full one and carried the
       * load back out to the fields. Reported as workers overdelivering to a
       * full crate with an empty one standing beside it.
       */
      if c.carrying is not null then
        select * into v_store from worker_store(p_world, c, c.carrying->>'def', (c.carrying->>'count')::int);
        if v_store.id is null then
          perform worker_nowhere(p_world, c);
          c.until := now() + interval '30 seconds';
          c.phase := 'idle';
          c.leg_at := c.until; c.leg_ends := c.until;
          exit;
        end if;
        if sqrt((v_store.cx - cx) ^ 2 + (v_store.cy - cy) ^ 2) > 1.6 then
          -- The room is somewhere else now: walk there rather than stand at a
          -- full crate holding a load.
          dist := sqrt((v_store.cx - cx) ^ 2 + (v_store.cy - cy) ^ 2);
          c.from_x := cx; c.from_y := cy; c.to_x := v_store.cx; c.to_y := v_store.cy;
          c.leg_at := c.until;
          c.leg_ends := c.leg_at + make_interval(secs => greatest(0.2, dist / greatest(0.1, pace)));
          c.until := c.leg_ends;
          continue;
        end if;
        if v_store.kind = 'crate' then
          v_in := crate_add(p_world, v_store.id::int, c.carrying->>'def',
            (c.carrying->>'count')::int, (c.carrying->>'ql')::double precision, c.carrying->>'extra');
        else
          v_in := furniture_add(p_world, v_store.id, c.carrying->>'def',
            (c.carrying->>'count')::int, (c.carrying->>'ql')::double precision, c.carrying->>'extra');
        end if;
        if v_in then c.carrying := null; end if;
      end if;
      c.phase := 'idle';
      c.leg_at := c.until; c.leg_ends := c.until;
      c.until := c.until + interval '1 second';

    else
      select * into spot from find_work_tile(p_world, v_site.x, v_site.y, v_site.radius, kind, c);
      if spot.x is null then
        -- Nothing of its trade anywhere it can reach. It wanders a few tiles
        -- and waits, which from outside is a beast standing about for no
        -- reason anybody is ever told. The clock on it starts here; whether
        -- that is worth a word is `worker_idle`'s to decide, and it wants an
        -- hour of it before it says anything, so that a trade which has run
        -- dry for the day is not mistaken for one that is stuck.
        c.idle_since := coalesce(c.idle_since, now());
        perform worker_idle(p_world, c, kind, v_site.x, v_site.y, v_site.radius, v_site.post);
        c.from_x := cx; c.from_y := cy;
        c.to_x := v_site.x + 0.5 + (hash_tile(p_id, guard, 601) * 2 - 1) * 3;
        c.to_y := v_site.y + 0.5 + (hash_tile(p_id, guard, 701) * 2 - 1) * 3;
        if not creature_tile_ok(p_world, floor(c.to_x)::int, floor(c.to_y)::int) then
          c.to_x := cx; c.to_y := cy;
        end if;
        dist := sqrt((c.to_x - cx) ^ 2 + (c.to_y - cy) ^ 2);
        c.leg_at := now();
        c.leg_ends := c.leg_at + make_interval(secs => greatest(0.2, dist / greatest(0.1, pace)));
        c.until := c.leg_ends + interval '4 seconds';
        exit;
      else
        -- Worked from the bank when there is no standing on it: always for a
        -- tree, a rod or a fruit bough, and for a rock face when the water
        -- over it is deeper than a beast can wade.
        if kind in ('woodcut', 'prune', 'fish', 'fruit')
           or (kind in ('mine', 'quarry') and not creature_tile_ok(p_world, spot.x, spot.y)) then
          select * into stand from beside_tile(p_world, spot.x, spot.y);
          if stand.x is null then
            /*
             * A tile of its trade with nowhere to stand and work it from.
             *
             * This added four seconds and went round again, and round again
             * re-derived the very same tile: `find_work_tile` walks the rings
             * outward from the site and hands back the first thing that
             * passes, so nothing about waiting changes which tile that is.
             * The only thing that could is the ground itself. A beast in here
             * stands still for ever and says nothing, which is the shape of
             * every bad hour this island has had lately.
             *
             * It is unreachable today, and that is worth being plain about:
             * `worker_gatherable` demands `face_reach`, and `face_reach` only
             * passes without standing room when `beside_tile` has something in
             * it, so the two cannot presently disagree. This is written as a
             * refusal rather than a retry so that the next rule added to one
             * of them and not the other is a worker that goes quiet and gets
             * reported, not one that spins in silence.
             *
             * Having found a tile it cannot work is having found nothing, so
             * it leaves by the same door: the idle clock starts, and an hour
             * of it is a word to the keeper.
             */
            c.idle_since := coalesce(c.idle_since, now());
            perform worker_idle(p_world, c, kind, v_site.x, v_site.y, v_site.radius, v_site.post);
            c.from_x := cx; c.from_y := cy;
            c.leg_at := now(); c.leg_ends := now();
            c.until := now() + interval '4 seconds';
            exit;
          end if;
          ax := stand.x + 0.5; ay := stand.y + 0.5;
        else
          ax := spot.x + 0.5; ay := spot.y + 0.5;
        end if;
        c.work_x := spot.x; c.work_y := spot.y;
        -- Anything found at all, and the idle clock starts over.
        c.idle_since := null;
        dist := sqrt((ax - cx) ^ 2 + (ay - cy) ^ 2);
        c.from_x := cx; c.from_y := cy; c.to_x := ax; c.to_y := ay;
        c.leg_at := c.until;
        c.leg_ends := c.leg_at + make_interval(secs => greatest(0.2, dist / greatest(0.1, pace)));
        c.until := c.leg_ends;
        c.phase := 'out';
      end if;
    end if;
  end loop;

  if c.until <= now() then
    c.from_x := c.to_x; c.from_y := c.to_y;
    c.leg_at := now(); c.leg_ends := now(); c.until := now() + interval '1 second';
  end if;

  update creature set from_x = c.from_x, from_y = c.from_y, to_x = c.to_x, to_y = c.to_y,
      leg_at = c.leg_at, leg_ends = c.leg_ends, until = c.until, phase = c.phase,
      work_x = c.work_x, work_y = c.work_y, carrying = c.carrying, fetching = c.fetching,
      idle_since = c.idle_since,
      enemy = c.enemy, settled_at = now()
    where world_id = p_world and id = p_id;
  return done;
end $function$;

CREATE OR REPLACE FUNCTION public.creature_settle(p_world uuid, p_id integer)
 RETURNS boolean
 LANGUAGE plpgsql
AS $function$
declare c creature; d species_def; a age_def; elapsed double precision; top double precision;
        guard int := 0; n int; i int; nx double precision; ny double precision;
        dist double precision; secs double precision; pace double precision; ok boolean;
        home record; ax double precision; ay double precision; v_rig placed;
begin
  select * into c from creature where world_id = p_world and id = p_id for update;
  if not found then return false; end if;
  select * into d from species_def where id = c.species;
  a := age_row(c.born);
  /*
   * In the traces until somebody takes it out.
   *
   * A hitch was a column and nothing else read it: the settle below went on
   * walking a companion to its keeper's feet and sending a worker out to its
   * trade, so an animal backed into a yoke was at its owner's heels a second
   * later, still hitched to a wagon it was nowhere near. It stands at the
   * vehicle now, thinks nothing, and does not get hungry, until `unhitch_one`
   * or `unhitch_all` takes it out -- or what it was hitched to is gone, in
   * which case there is nothing left to be in the traces of.
   */
  if c.hitched_to is not null then
    select * into v_rig from placed where world_id = p_world and id = c.hitched_to;
    if not found then
      update creature set hitched_to = null where world_id = p_world and id = p_id;
      c.hitched_to := null;
    end if;
  end if;
  elapsed := extract(epoch from (now() - c.settled_at));
  if elapsed <= 0 then
    -- Nothing has passed for the body — but a worker's day is not its body,
    -- and the trips it is owed are still owed. One in the traces owes none.
    if c.hitched_to is not null then return false; end if;
    if c.mode = 'deed' then perform worker_settle(p_world, p_id);
    elsif c.mode = 'active' then perform companion_settle(p_world, p_id); end if;
    return false;
  end if;

  -- The body: hunger falling, wounds closing, fleece coming back, and a
  -- brushing wearing off. None of it needs a step; it is all just elapsed time.
  top := max_health(c);
  -- Except in the traces, where the belly holds where it was when it went in.
  if c.hitched_to is null then
    c.hunger := greatest(0, c.hunger - elapsed * hunger_rate(c.mode) * beast_mul(c, 'appetite'));
  end if;
  if c.health > top then
    c.health := top;
  elsif c.health < top and (c.hurt_at is null or now() - c.hurt_at > interval '6 seconds') then
    c.health := least(top, c.health + elapsed * case when c.mode = 'wild' then 0.25 else 0.6 end * beast_mul(c, 'mend'));
  end if;
  if d.fleece is not null and a.growth > 0 and c.fleece < 1 then
    c.fleece := least(1, c.fleece + elapsed * d.fleece * a.growth * beast_mul(c, 'grow'));
  end if;
  c.care := greatest(0, c.care - elapsed / (3 * 3600));
  /*
   * And a hungry one on a deed goes to the stores.
   *
   * Written on the row rather than on `c`, so the settle below does not carry
   * the old belly back over it. Only when it is actually hungry, which for a
   * worker is an hour or so apart — this is not a cost anybody pays on a beat.
   */
  if c.mode <> 'wild' and c.hitched_to is null and c.hunger < graze_hungry() then
    if worker_feed(p_world, p_id) is not null then
      c.hunger := least(1, c.hunger + graze_fill());
    end if;
  end if;

  -- And no further: it stands at the vehicle, the body settled and nothing else.
  if c.hitched_to is not null then
    update creature set
        from_x = v_rig.cx, from_y = v_rig.cy, to_x = v_rig.cx, to_y = v_rig.cy,
        leg_at = now(), leg_ends = now(), until = now(),
        health = c.health, fleece = c.fleece, care = c.care,
        enemy = null, hunting = null, settled_at = now()
      where world_id = p_world and id = p_id;
    return true;
  end if;

  if c.mode = 'wild' then
    if d.hunter then c := hunt_settle(p_world, c, d, a); else c.hunting := null; end if;
  else
    c.hunting := null;
  end if;

  if c.mode = 'wild' and c.hunting is null then
    pace := d.speed * a.speed * beast_mul(c, 'speed') * 0.7;
    while c.until <= now() and guard < catch_up_legs() loop
      guard := guard + 1;
      n := c.leg + 1;
      ok := false;
      -- A step about its own country rather than a step from wherever it
      -- last got to. Past the edge of its range it draws towards home
      -- instead, which is what keeps an island's wildlife somewhere in
      -- particular. A creature from before homes existed takes where it
      -- stands, which is what it would have had anyway.
      if c.home_x is null then c.home_x := c.to_x; c.home_y := c.to_y; end if;
      if (c.to_x - c.home_x) ^ 2 + (c.to_y - c.home_y) ^ 2 > wild_range() ^ 2 then
        ax := c.home_x; ay := c.home_y;
      else
        ax := c.to_x; ay := c.to_y;
      end if;
      for i in 0..7 loop
        nx := ax + (hash_tile(p_id, n, 7001 + i) * 2 - 1) * wild_reach();
        ny := ay + (hash_tile(p_id, n, 9001 + i) * 2 - 1) * wild_reach();
        if creature_tile_ok(p_world, floor(nx)::int, floor(ny)::int)
           and line_clear(p_world, c.to_x, c.to_y, nx, ny) then ok := true; exit; end if;
      end loop;
      c.leg := n;
      if not ok then
        -- Hemmed in: stand where it is and look again in a moment.
        c.from_x := c.to_x; c.from_y := c.to_y;
        c.leg_at := c.until; c.leg_ends := c.until;
        c.until := c.until + interval '2 seconds';
        continue;
      end if;
      -- It feeds itself on the way. The browser walks it to a forage bed,
      -- grazes for a few seconds and tops the belly up; out here the leg that
      -- ends on ground worth grazing is the same thing without the detail.
      if c.hunger < graze_hungry() and coalesce((select forage from tile_def
            where id = land_tile(p_world, floor(nx)::int, floor(ny)::int)), false) then
        c.hunger := least(1, c.hunger + graze_fill());
      end if;
      dist := sqrt((nx - c.to_x) ^ 2 + (ny - c.to_y) ^ 2);
      secs := greatest(0.2, dist / greatest(0.1, pace));
      c.from_x := c.to_x; c.from_y := c.to_y;
      c.to_x := nx; c.to_y := ny;
      c.leg_at := c.until;
      c.leg_ends := c.leg_at + make_interval(secs => secs);
      c.until := c.leg_ends + make_interval(secs => wild_rest() + hash_tile(p_id, n, 11001) * wild_rest_spread());
    end loop;
    /*
     * And past the cap it is where it got to, and the clock catches up with
     * it. This line is the whole reason the cap can come down: it was already
     * here, and it was already the answer for anything more than forty legs
     * behind. Forty was doing an eighth of a second of arithmetic to reach an
     * answer this line gives for nothing.
     *
     * Measured, on a creature an hour behind: 109.10 ms with the cap at forty,
     * against 4.78 ms for one a second behind. Every one of those legs is a
     * random step inside a home range nobody was standing in.
     */
    if c.until <= now() then
      c.from_x := c.to_x; c.from_y := c.to_y;
      c.leg_at := now(); c.leg_ends := now();
      c.until := now() + make_interval(secs => 1 + hash_tile(p_id, c.leg, 11001) * 5);
    end if;
  elsif c.mode = 'active' and c.keeper is not null and c.enemy is null then
    -- A companion is wherever its keeper is; following is not a walk of its own.
    -- A fight is, and one with something in its teeth keeps the legs it has:
    -- `companion_settle`, below, walks it, strikes, and brings it back to heel.
    select p.x, p.y into home from player p where p.world_id = p_world and p.uid = c.keeper;
    if found then
      c.from_x := home.x; c.from_y := home.y; c.to_x := home.x; c.to_y := home.y;
      c.leg_at := now(); c.leg_ends := now(); c.until := now();
    end if;
  elsif c.mode = 'stored' then
    -- In a crate: where the crate stands, or at the feet of whoever carries it.
    select pl.cx as x, pl.cy as y into home from placed pl where pl.world_id = p_world and pl.creature = p_id limit 1;
    if not found then
      select py.x, py.y into home from player py where py.world_id = p_world and py.uid = c.keeper;
    end if;
    if found then
      c.from_x := home.x; c.from_y := home.y; c.to_x := home.x; c.to_y := home.y;
      c.leg_at := now(); c.leg_ends := now(); c.until := now();
    end if;
  end if;

  update creature set
      from_x = c.from_x, from_y = c.from_y, to_x = c.to_x, to_y = c.to_y,
      leg_at = c.leg_at, leg_ends = c.leg_ends, until = c.until, leg = c.leg,
      health = c.health, hunger = c.hunger, fleece = c.fleece, care = c.care,
      hunting = c.hunting, hunt_x = c.hunt_x, hunt_y = c.hunt_y, hunt_again = c.hunt_again,
      home_x = c.home_x, home_y = c.home_y,
      settled_at = now()
    where world_id = p_world and id = p_id;
  -- And then the day's work, for whichever of them is on a deed rather than
  -- out in the country. The row goes down first because the work reads it back.
  if c.mode = 'deed' then perform worker_settle(p_world, p_id);
  -- And a companion's company, which is the one thing at heel that is a walk of its own.
  elsif c.mode = 'active' then perform companion_settle(p_world, p_id); end if;
  return true;
end $function$;

CREATE OR REPLACE FUNCTION public.hitch_up(p_world uuid, p_id integer, p_piece bigint)
 RETURNS boolean
 LANGUAGE plpgsql
AS $function$
declare c creature; p placed; v vehicle_def;
begin
  select * into c from creature where world_id = p_world and id = p_id;
  if not found or c.hitched_to is not null or c.rider is not null or c.mode = 'stored' then return false; end if;
  select * into p from placed where world_id = p_world and id = p_piece;
  select * into v from vehicle_def where id = p.sub;
  if not found or team_size(p_world, p_piece) >= v.yokes then return false; end if;
  update creature set hitched_to = p_piece, carrying = null, enemy = null, hunting = null,
      from_x = p.cx, from_y = p.cy, to_x = p.cx, to_y = p.cy,
      leg_at = now(), leg_ends = now(), settled_at = now()
    where world_id = p_world and id = p_id;
  return true;
end $function$;

CREATE OR REPLACE FUNCTION public.vehicle_for(p_world uuid, p_uid uuid, c creature)
 RETURNS placed
 LANGUAGE plpgsql
 STABLE
AS $function$
begin
  return vehicle_near(p_world, creature_x(c), creature_y(c), 5);
end $function$;

CREATE OR REPLACE FUNCTION public.ride_refusal(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS text
 LANGUAGE plpgsql
AS $function$
declare c creature; d species_def; p placed; v vehicle_def; want text; n int;
begin
  if ride_beast_action(p_action) then
    perform creature_settle(p_world, (p_target->>'id')::int);
    c := target_creature(p_world, p_target);
    if c.world_id is null then return 'It is gone.'; end if;
    select * into d from species_def where id = c.species;
    if c.mode = 'stored' then return c.name || ' is in a creature crate. Let it out first.'; end if;

    if p_action = 'tack_creature' then
      if not creature_in_reach(p_world, p_uid, c) then return 'Stand next to ' || c.name || '.'; end if;
      if not (age_row(c.born)).works then
        return c.name || ' is not grown. Nothing that young takes a saddle.';
      end if;
      want := tack_missing(p_world, p_uid);
      if want is not null then return 'You need ' || want || '.'; end if;

    elsif p_action = 'shoe_creature' then
      -- Shoes, in the words the browser uses: a mount, grown, within reach,
      -- and four shoes and a mallet in the pack.
      if d.mount is null then return 'Only a mount takes shoes.'; end if;
      if not creature_in_reach(p_world, p_uid, c) then return 'Stand next to ' || c.name || '.'; end if;
      if not (age_row(c.born)).works then
        return c.name || ' is not grown. Nothing that young takes a shoe.';
      end if;
      if pack_count(p_world, p_uid, 'horseshoe') < shoes_per_mount()::int or pack_count(p_world, p_uid, 'mallet') < 1 then
        return 'You need four horseshoes and a mallet.';
      end if;

    elsif p_action = 'untack_creature' then
      if not creature_in_reach(p_world, p_uid, c) then return 'Stand next to ' || c.name || '.'; end if;

    elsif p_action = 'mount_creature' then
      if not c.tacked then return c.name || ' has no saddle or bridle on.'; end if;
      if not (age_row(c.born)).works then return c.name || ' is not grown enough to carry you.'; end if;
      if c.hitched_to is not null then return c.name || ' is in the traces.'; end if;
      if not creature_in_reach(p_world, p_uid, c) then return 'Stand next to ' || c.name || '.'; end if;
      if (driving(p_world, p_uid)).id is not null then
        return 'Get down off what you are driving first.';
      end if;

    elsif p_action = 'hitch_creature' then
      -- Asked of one already in harness, which a browser that could not see
      -- the traces was offering: `hitch_up` said no and nobody heard why.
      if c.hitched_to is not null then return c.name || ' is already in the traces.'; end if;
      if c.rider is not null then return c.name || ' has a rider on it.'; end if;
      p := vehicle_for(p_world, p_uid, c);
      if p.id is null then return 'There is no cart or wagon here with an empty yoke.'; end if;
      if not near_piece(p_world, p_uid, p) then
        return 'Stand by the ' || lower(placed_name(p)) || '.';
      end if;
      if not creature_in_reach(p_world, p_uid, c, 4) then
        return c.name || ' is too far off. Call it over first.';
      end if;
      if not (age_row(c.born)).works then
        return c.name || ' is not grown. A yearling is no use in the traces.';
      end if;
      if c.hunger < 0.15 then
        return c.name || ' is too hungry to pull anything. Feed it first.';
      end if;

    elsif p_action = 'unhitch_creature' then
      if c.hitched_to is null then return c.name || ' is not in the traces.'; end if;
    end if;
    return null;
  end if;

  -- The rest are asked of a thing standing on the ground.
  select * into p from placed where world_id = p_world and id = (p_target->>'id')::bigint
    and kind = 'furniture';
  if not found then return 'It is gone.'; end if;

  if p_action = 'pull_cart' then
    if not near_piece(p_world, p_uid, p) then return 'Stand beside the shafts.'; end if;
    if exists (select 1 from placed q where q.world_id = p_world and q.puller = p_uid and q.id <> p.id) then
      return 'You already have a cart behind you.';
    end if;

  elsif p_action = 'board_vehicle' then
    if not near_piece(p_world, p_uid, p) then return 'Stand beside it first.'; end if;
    if (driving(p_world, p_uid)).id is not null then return 'You are already driving something.'; end if;
    -- A hull asks nothing but that she is still floating.
    if is_boat(p) then
      if not launch_spot(p_world, p.sub, p.x, p.y) then return 'She is aground. Push her off first.'; end if;
      return null;
    end if;
    select * into v from vehicle_def where id = p.sub;
    if found then
      n := team_size(p_world, p.id);
      if n < v.needs then
        return case when n = 0
          then 'Nothing is in the yokes. ' || placed_name(p) || ' needs ' || v.needs || ' to move.'
          else 'Only ' || n || ' of ' || v.yokes || ' yokes are filled. It needs ' || v.needs || '.' end;
      end if;
    end if;

  elsif p_action = 'leave_vehicle' then
    if is_boat(p) and not exists (select 1 from player pl, lateral shore_near(p_world, pl.x, pl.y)
                                  where pl.world_id = p_world and pl.uid = p_uid) then
      return 'There is no shore within reach. Bring her in first, or swim for it.';
    end if;

  elsif p_action = 'unhitch_team' then
    if not near_piece(p_world, p_uid, p) then return 'Stand beside it first.'; end if;
  end if;
  return null;
end $function$;

CREATE OR REPLACE FUNCTION public.trap_refusal(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS text
 LANGUAGE plpgsql
AS $function$
declare p placed; d trap_def; it item; c creature; s species_def;
begin
  if p_action = 'set_trap' then
    select * into it from item where world_id = p_world and holder = 'player' and holder_uid = p_uid
      and not locked and exists (select 1 from trap_def td where td.id = item.def)
      and (target_item(p_target) is null or id = target_item(p_target))
      order by id limit 1;
    if not found then return 'You have no trap to set.'; end if;
    return trap_place_reason(p_world, p_uid, it.def, (p_target->>'x')::int, (p_target->>'y')::int,
      coalesce((p_target->>'sx')::int, 0), coalesce((p_target->>'sy')::int, 0));
  end if;

  -- Everything else is asked of a trap, so the trap is rolled forward first:
  -- one nobody has looked at for an hour may have caught something, or rotted.
  perform trap_settle((p_target->>'id')::bigint);
  select * into p from placed where world_id = p_world and id = (p_target->>'id')::bigint
    and kind = 'trap';
  if not found then return 'It is gone.'; end if;
  select * into d from trap_def where id = p.sub;
  if not near_piece(p_world, p_uid, p) then
    return case when d.water then 'Stand at the creel.' else 'Stand at the trap.' end;
  end if;

  if p_action = 'bait_trap' then
    if p.caught is not null then return 'There is something in it already.'; end if;
    if (bait_in_pack(p_world, p_uid, d.water)).id is null then
      return case when d.water
        then 'You have nothing a fish would come to. Dig worms, or use corn, meat or a small fish.'
        else 'You have nothing anything would come to. Carry a berry, a vegetable, a nut, a spice.' end;
    end if;

  elsif p_action = 'take_catch' then
    if p.caught is null then return 'There is nothing in it.'; end if;
    select * into c from creature where world_id = p_world and id = p.caught;
    if not found then return 'Whatever was in it is gone.'; end if;
    select * into s from species_def where id = c.species;
    if skill_of(p_world, p_uid, 'taming') < s.tame_level then
      return 'A ' || lower(s.name) || ' takes taming ' || to_char(s.tame_level, 'FM990')
        || ' to handle, trapped or not. It is held; come back when you can.';
    end if;
    -- The same rule as taming: the first follows you, and every one after that goes into a crate.
    if tame_room_refusal(p_world, p_uid) is not null then return tame_room_refusal(p_world, p_uid); end if;

  elsif p_action = 'free_catch' then
    if p.caught is null then return 'There is nothing in it.'; end if;

  elsif p_action = 'empty_creel' then
    if not d.water then return 'That is not a creel.'; end if;
    if not exists (select 1 from item i where i.holder = 'trap' and i.placed = p.id) then
      return 'There is nothing in it yet.';
    end if;

  elsif p_action = 'pick_up_trap' then
    if p.caught is not null then return 'Deal with what is in it first.'; end if;
  end if;
  return null;
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
    v_back := give(p_world, p_uid, p.sub, 1, p.ql, p.material);
    update item set dmg = trap_dmg(p) where id = v_back;
    perform tell(p_world, p_uid, 'You take the ' || lower(trap_name(p)) || ' up'
      || case when p.bait is not null then ' and pocket the bait' else '' end || '.', 'event');
    delete from placed where id = p.id;
    perform land_announce(p_world, p.x, p.y);
  end if;
end $function$;

CREATE OR REPLACE FUNCTION public.perform_settlement(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare dd deed; p placed; it item; c creature; v_name text; v_level int; v_sx int; v_sy int;
        v_freed int := 0; v_tipped int := 0; cr crate; r record;
begin
  if p_action = 'upgrade_deed' then
    select * into dd from deed where world_id = p_world and founded_by = p_uid;
    v_level := dd.level + 1;
    update deed set level = v_level, radius = deed_radius(v_level)
      where world_id = p_world and founded_by = p_uid;
    perform tell(p_world, p_uid, dd.name || ' grows to level ' || v_level
      || '. The border reaches ' || deed_radius(v_level) || ' tiles from the token and '
      || worker_cap(p_world, p_uid) || ' wildermon may work here.', 'system');
    perform land_announce(p_world, dd.x, dd.y);

  elsif p_action = 'rename_deed' then
    v_name := left(btrim(p_target->>'name'), 32);
    update deed set name = v_name where world_id = p_world and founded_by = p_uid;
    perform tell(p_world, p_uid, 'The settlement is now called ' || v_name || '.', 'system');

  elsif p_action = 'disband_deed' then
    select * into dd from deed where world_id = p_world and founded_by = p_uid;
    -- Everything working here runs wild, and what it was carrying goes on the
    -- ground where it stood rather than with it. One in a creature crate is in
    -- your crate rather than the settlement's, and stays yours.
    for c in select * from creature where world_id = p_world and keeper = p_uid and mode = 'deed' loop
      if c.carrying is not null then
        perform drop_on_ground(p_world, floor(creature_x(c))::int, floor(creature_y(c))::int,
          c.carrying->>'def', (c.carrying->>'ql')::double precision, c.carrying->>'extra',
          (c.carrying->>'count')::int);
      end if;
      update creature set mode = 'wild', phase = 'idle', job = null, post = null, carrying = null,
          name = (select name from species_def where id = c.species)
        where world_id = p_world and id = c.id;
      v_freed := v_freed + 1;
    end loop;
    -- The settlement's own crate goes with the settlement, and whatever was in
    -- it is tipped out where it stood rather than vanishing with it.
    cr := deed_crate(p_world, p_uid);
    if cr.id is not null then
      for r in select * from item where world_id = p_world and crate = cr.id loop
        update item set holder = 'ground', holder_uid = null, crate = null, gx = cr.x, gy = cr.y
          where id = r.id;
        v_tipped := v_tipped + 1;
      end loop;
      delete from crate where world_id = p_world and id = cr.id;
    end if;
    /*
     * Yours, and not the island's.
     *
     * Reported by somebody whose settlement was gone while his crate still
     * stood and who had not disbanded anything: somebody else had, at the
     * other end of the island, and this line took every settlement on it. The
     * deed crate is the tell — the disbanding tips out and removes the
     * *caller's* crate, so everybody else was left with an orphan standing in
     * a field and nothing to say what it had belonged to.
     *
     * `deed` was keyed on the island alone until a day ago, when it became
     * `(world_id, founded_by)`. The reads either side of this were re-scoped
     * with the key; the delete was not, and a delete is the one statement
     * where the whole island being in range does not read as a mistake.
     */
    delete from deed where world_id = p_world and founded_by = p_uid;
    perform tell(p_world, p_uid, dd.name || ' is disbanded. '
      || v_freed || case when v_freed = 1 then ' wildermon runs' else ' wildermon run' end
      || ' wild and ' || v_tipped
      || case when v_tipped = 1 then ' thing is' else ' things are' end
      || ' tipped out where the crate stood.', 'system');
    perform land_announce(p_world, dd.x, dd.y);

  elsif p_action = 'place_post' then
    select * into it from item where world_id = p_world and holder = 'player' and holder_uid = p_uid
      and def = 'work_post' and not locked
      and (target_item(p_target) is null or id = target_item(p_target))
      order by id limit 1;
    if not found then return; end if;
    v_sx := least(subtiles() - 1, greatest(0, coalesce((p_target->>'sx')::int, 0)));
    v_sy := least(subtiles() - 1, greatest(0, coalesce((p_target->>'sy')::int, 0)));
    insert into placed (world_id, kind, sub, x, y, sx, sy, cx, cy, ql, made_by)
    values (p_world, 'post', it.extra, (p_target->>'x')::int, (p_target->>'y')::int, v_sx, v_sy,
            (p_target->>'x')::int + (v_sx + 0.5) / subtiles(),
            (p_target->>'y')::int + (v_sy + 0.5) / subtiles(), it.ql, p_uid)
    returning * into p;
    delete from item where id = it.id;
    perform tell(p_world, p_uid, 'You drive the post in and tack the ribbon to it. It will stand about '
      || round(post_life(p.ql) / 60) || ' minutes and reach ' || post_radius(p.ql)
      || ' tiles. Set a wildermon to it.', 'event');
    perform land_announce(p_world, p.x, p.y);
    return;
  end if;

  if p_action in ('upgrade_deed', 'rename_deed', 'disband_deed') then return; end if;

  select * into p from placed where world_id = p_world and id = (p_target->>'id')::bigint;
  if not found then return; end if;

  if p_action = 'pick_up_post' then
    -- Half rotten by now, most likely, and it comes up as it went in.
    perform give(p_world, p_uid, 'work_post', 1,
      greatest(1, p.ql * (1 - post_dmg(p) / 100)), p.sub);
    update creature set post = null, phase = 'idle' where world_id = p_world and post = p.id;
    delete from placed where id = p.id;
    perform tell(p_world, p_uid, 'You pull the post up and coil the ribbon round it.', 'event');
    perform land_announce(p_world, p.x, p.y);

  elsif p_action = 'assign_post' then
    select * into c from creature where world_id = p_world and id = (p_target->>'creature')::int;
    if not found then return; end if;
    update creature set post = p.id, mode = 'deed', phase = 'idle', enemy = null, hunting = null,
        from_x = p.cx, from_y = p.cy + 0.6, to_x = p.cx, to_y = p.cy + 0.6,
        leg_at = now(), leg_ends = now(), until = now(), settled_at = now()
      where world_id = p_world and id = c.id;
    perform journal_note(p_world, p_uid, 'posted');
    perform tell(p_world, p_uid, c.name || ' will '
      || coalesce((select g.plain from gather_def g
                   where g.id = (select gathers from species_def where id = c.species)),
                  'keep to the post')
      || ' within ' || least(work_range(c), post_radius(p.ql))
      || ' tiles of the post while it stands. (' || post_state(p) || ')', 'system');

  elsif p_action = 'unassign_post' then
    select * into c from creature where world_id = p_world and post = p.id limit 1;
    if not found then return; end if;
    select * into dd from my_deed(p_world, c.keeper) md where md.world_id is not null;
    update creature set post = null, phase = 'idle',
        from_x = coalesce(dd.x + 0.5, p.cx), from_y = coalesce(dd.y + 1.5, p.cy),
        to_x = coalesce(dd.x + 0.5, p.cx), to_y = coalesce(dd.y + 1.5, p.cy),
        leg_at = now(), leg_ends = now(), until = now(), settled_at = now()
      where world_id = p_world and id = c.id;
    perform tell(p_world, p_uid, c.name || ' is called off the post.', 'system');
  end if;
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
      'mode', c.mode, 'stance', c.stance, 'job', c.job, 'shod', shod(c),
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


/* ---- nothing is kept at a token any more -------------------------------- */

/*
 * Every wildermon kept at a token goes into a creature crate of its own: set
 * down beside its keeper's token where a spot is free, and in the keeper's
 * pack where none is -- which is where the browser puts a solo game's. The
 * keeper is told. One born at a token with nobody's name on it, which is what
 * a birth did until today, is nobody's, and goes off into the wild.
 */
do $crates$
declare v_c creature; v_dd deed; v_x int; v_y int; v_sx int; v_sy int; v_item bigint; v_told record;
begin
  for v_c in select * from creature where mode = 'stored' order by world_id, keeper, id loop
    if v_c.keeper is null or not exists (select 1 from player py where py.world_id = v_c.world_id and py.uid = v_c.keeper) then
      update creature set mode = 'wild', keeper = null, stance = 'passive', settled_at = now()
        where world_id = v_c.world_id and id = v_c.id;
      continue;
    end if;
    v_dd := my_deed(v_c.world_id, v_c.keeper);
    v_x := null; v_y := null; v_sx := null; v_sy := null;
    if v_dd.world_id is not null then
      select s.x, s.y, s.sx, s.sy into v_x, v_y, v_sx, v_sy
        from crate_spot_near(v_c.world_id, v_dd.x, v_dd.y, v_dd.radius) s;
    end if;
    if v_x is not null then
      insert into placed (world_id, kind, sub, x, y, sx, sy, cx, cy, ql, made_by, facing, creature)
      values (v_c.world_id, 'furniture', 'creature_crate', v_x, v_y, v_sx, v_sy,
              v_x + (v_sx + 1.0) / subtiles(), v_y + (v_sy + 1.0) / subtiles(),
              20, v_c.keeper, 's', v_c.id);
      perform land_announce(v_c.world_id, v_x, v_y);
    else
      v_item := give(v_c.world_id, v_c.keeper, 'creature_crate', 1, 20);
      update item set creature = v_c.id where id = v_item;
    end if;
    perform creature_settle(v_c.world_id, v_c.id);
  end loop;
  for v_told in
    select c.world_id, c.keeper, count(*) as n from creature c
     where c.mode = 'stored' and c.keeper is not null
       and (exists (select 1 from placed pl where pl.world_id = c.world_id and pl.creature = c.id)
            or exists (select 1 from item i where i.world_id = c.world_id and i.creature = c.id))
     group by c.world_id, c.keeper
  loop
    perform tell(v_told.world_id, v_told.keeper, 'Wildermon are no longer kept at the token. '
      || case when v_told.n = 1 then 'The one you kept there is' else 'The ' || v_told.n || ' you kept there are' end
      || ' each in a creature crate now, set down near your token where there was room and otherwise in your pack. '
      || 'Open a crate to have one follow you or work the deed.', 'system');
  end loop;
end $crates$;
