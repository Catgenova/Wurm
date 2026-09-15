-- A settlement each, rather than one to the island.
--
-- Reported by somebody who could see a stranger's homestead as if it were
-- their own lit ground, whose journal was being ticked off by that stranger's
-- work, and who could not plant their own stake because the stranger had
-- planted theirs. Three complaints, one cause: `deed` was keyed on the island
-- and nothing else.
--
--     deed_pkey  primary key (world_id)
--
-- One row, so `select * from deed where world_id = p_world` was a complete
-- sentence, and thirty functions wrote it. The browser then hung its own
-- meaning on the answer: `vision.ts` lights your settlement whatever the hour
-- and however far off it is, which is right and which made a stranger's
-- homestead a hole cut in the fog; `journal.ts` ticks "plant a stake and found
-- a settlement" off `!!g.deed`, which somebody else had done.
--
-- That is what a single-player game looks like when it is put in a database
-- and left there. It was never a bug in any of the thirty — each of them is
-- exactly right about a world with one settlement in it.
--
-- ## What replaces it
--
-- The key is `(world_id, founded_by)`: one settlement per person per island,
-- which is the rule the old message already claimed to be enforcing. Two
-- functions carry the whole distinction that the old key hid:
--
--   * `my_deed(world, uid)` — the settlement *you* hold. Everything about
--     upkeep, upgrading, keeping wildermon, and what your journal has done.
--   * `deed_at(world, x, y)` — the settlement standing *here*, whoever holds
--     it. Everything about the ground: what may be built, what rots slowly,
--     where a beast may graze, whether a monster will come this close.
--
-- Every one of the thirty was one of those two, and reading them to find out
-- which is the whole of the work. `on_deed` was already the second kind and
-- needs no change at all beyond dropping the assumption of one row.
--
-- Settlements may not overlap. Without that, two people found on top of each
-- other and `deed_at` has to pick, and every answer it could pick is wrong.

/** The settlement this person holds on this island, if any. */
create or replace function my_deed(p_world uuid, p_uid uuid) returns deed
  language sql stable as $$
  select d.* from deed d where d.world_id = p_world and d.founded_by = p_uid
$$;

/**
 * And the settlement standing on this tile, whoever holds it.
 *
 * `limit 1` is belt and braces rather than a choice: `deed_refusal` refuses a
 * settlement that would touch another, so at most one covers any tile. If that
 * ever stops being true this returns the older one rather than a random one,
 * which is at least the same answer twice.
 */
create or replace function deed_at(p_world uuid, p_x int, p_y int) returns deed
  language sql stable as $$
  select d.* from deed d
   where d.world_id = p_world
     and abs(p_x - d.x) <= d.radius and abs(p_y - d.y) <= d.radius
   order by d.founded_at limit 1
$$;

/* ------------------------------------------------------------------ *
 * The key.
 * ------------------------------------------------------------------ */

-- A settlement nobody holds cannot be anybody's, and there is nothing sensible
-- to do with it once every rule about a settlement starts with whose it is.
delete from deed where founded_by is null;
alter table deed alter column founded_by set not null;
alter table deed drop constraint if exists deed_pkey;
alter table deed add constraint deed_pkey primary key (world_id, founded_by);

select private.lock_doors();
drop function if exists deed_crate(uuid);
drop function if exists worker_cap(uuid);
drop function if exists workers_on_deed(uuid);
drop function if exists place_deed_crate(uuid);
drop function if exists upgrade_reason(uuid);
drop function if exists upgrade_wants(uuid,integer);

CREATE OR REPLACE FUNCTION public.cast_reason(p_world uuid, p_uid uuid, p_cast text, p_uid_item bigint)
 RETURNS text
 LANGUAGE plpgsql
AS $function$
declare d cast_def; it item; faith double precision; have double precision;
begin
  select * into d from cast_def where id = p_cast;
  if not found then return 'Choose what to call for.'; end if;
  faith := skill_of(p_world, p_uid, faith_skill());
  if faith < d.level then
    return d.name || ' takes ' || to_char(d.level, 'FM990') || ' prayer; you have '
      || to_char(faith, 'FM990') || '.';
  end if;
  have := favour_settle(p_world, p_uid);
  if have < d.cost then
    return d.name || ' costs ' || to_char(d.cost, 'FM990') || ' favour; you hold '
      || to_char(floor(have), 'FM990') || '. Pray at an altar.';
  end if;
  if p_uid_item is not null then
    select * into it from item where world_id = p_world and id = p_uid_item
      and holder = 'player' and holder_uid = p_uid;
  end if;
  if d.on_what = 'item' and it.id is null then return 'Choose something to lay it on.'; end if;
  if p_cast = 'mend' and it.id is not null and it.dmg <= 0 then
    return 'There is nothing wrong with the ' || lower(item_name(it)) || '.';
  end if;
  if p_cast = 'cunning' and it.id is not null then
    if coalesce(it.bless, 0) >= bless_cap() then
      return 'The ' || lower(item_name(it)) || ' has taken all it will take.';
    end if;
    if it.issued then return 'What you washed ashore with has nothing in it to work on.'; end if;
  end if;
  if p_cast = 'call' and not exists (select 1 from creature c where c.world_id = p_world
      and c.mode = 'active' and c.keeper = p_uid) then
    return 'Nothing travels with you.';
  end if;
  if p_cast = 'dawnlight' and jsonb_array_length((select wounds from player
      where world_id = p_world and uid = p_uid)) = 0 then
    return 'Nothing is open on you.';
  end if;
  if p_cast = 'bounty' and not exists (select 1 from deed where world_id = p_world and founded_by = p_uid) then
    return 'You have no settlement, and so no fields.';
  end if;
  return null;
end $function$;

CREATE OR REPLACE FUNCTION public.creature_refusal(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS text
 LANGUAGE plpgsql
AS $function$
declare c creature; d species_def; food text; held int; working int; cap int;
begin
  -- Walked forward before it is looked at: where it was is not where it is.
  perform creature_settle(p_world, (p_target->>'id')::int);
  c := target_creature(p_world, p_target);
  if c.world_id is null then return 'It is gone.'; end if;
  select * into d from species_def where id = c.species;

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
    if companion_of(p_world, p_uid) is not null and not exists (select 1 from deed where world_id = p_world and founded_by = p_uid) then
      return 'You already have a companion and no settlement to keep another.';
    end if;
    return null;

  elsif p_action = 'assign_deed' then
    if c.mode = 'wild' then return 'It is not yours to set to work.'; end if;
    if not exists (select 1 from deed where world_id = p_world and founded_by = p_uid) then
      return 'You have no settlement to assign it to.';
    end if;
    if d.gathers is null then return 'A ' || lower(d.name) || ' has no trade to be set to.'; end if;
    if not worker_job_ported(d.gathers) then
      return 'Nobody has taught this island what ' || (select plain from gather_def where id = d.gathers)
        || ' looks like yet.';
    end if;
    if c.mode <> 'deed' then
      working := workers_on_deed(p_world, p_uid);
      cap := worker_cap(p_world, p_uid);
      if working >= cap then
        return (select name from deed where world_id = p_world and founded_by = p_uid) || ' has work for ' || cap
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
    if c.mode not in ('deed', 'stored') then return 'It is already with you.'; end if;
    held := companion_of(p_world, p_uid);
    if held is not null and not exists (select 1 from deed where world_id = p_world and founded_by = p_uid) then
      return 'Nowhere to keep your current companion.';
    end if;
    return null;

  elsif p_action = 'store_creature' then
    if c.mode not in ('active', 'deed') then return 'It is already at the token.'; end if;
    if not exists (select 1 from deed where world_id = p_world and founded_by = p_uid) then
      return 'You have no settlement token to keep it at.';
    end if;
    return null;

  elsif p_action = 'release_creature' then
    if c.mode = 'wild' then return 'It is already wild.'; end if;
    return null;
  end if;
  return null;
end $function$;

CREATE OR REPLACE FUNCTION public.creature_settle(p_world uuid, p_id integer)
 RETURNS boolean
 LANGUAGE plpgsql
AS $function$
declare c creature; d species_def; a age_def; elapsed double precision; top double precision;
        guard int := 0; n int; i int; nx double precision; ny double precision;
        dist double precision; secs double precision; pace double precision; ok boolean;
        home record;
begin
  select * into c from creature where world_id = p_world and id = p_id for update;
  if not found then return false; end if;
  select * into d from species_def where id = c.species;
  a := age_row(c.born);
  elapsed := extract(epoch from (now() - c.settled_at));
  if elapsed <= 0 then return false; end if;

  -- The body: hunger falling, wounds closing, fleece coming back, and a
  -- brushing wearing off. None of it needs a step; it is all just elapsed time.
  top := max_health(c);
  c.hunger := greatest(0, c.hunger - elapsed * hunger_rate(c.mode) * trait_mul(c.traits, 'appetite'));
  if c.health > top then
    c.health := top;
  elsif c.health < top and (c.hurt_at is null or now() - c.hurt_at > interval '6 seconds') then
    c.health := least(top, c.health + elapsed * case when c.mode = 'wild' then 0.25 else 0.6 end);
  end if;
  if d.fleece is not null and a.growth > 0 and c.fleece < 1 then
    c.fleece := least(1, c.fleece + elapsed * d.fleece * a.growth * trait_mul(c.traits, 'grow'));
  end if;
  c.care := greatest(0, c.care - elapsed / (3 * 3600));

  if c.mode = 'wild' then
    if d.hunter then c := hunt_settle(p_world, c, d, a); else c.hunting := null; end if;
  else
    c.hunting := null;
  end if;

  if c.mode = 'wild' and c.hunting is null then
    pace := d.speed * a.speed * trait_mul(c.traits, 'speed') * 0.7;
    while c.until <= now() and guard < 40 loop
      guard := guard + 1;
      n := c.leg + 1;
      ok := false;
      for i in 0..7 loop
        nx := c.to_x + (hash_tile(p_id, n, 7001 + i) * 2 - 1) * wild_reach();
        ny := c.to_y + (hash_tile(p_id, n, 9001 + i) * 2 - 1) * wild_reach();
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
      if c.hunger < 0.5 and coalesce((select forage from tile_def
            where id = land_tile(p_world, floor(nx)::int, floor(ny)::int)), false) then
        c.hunger := least(1, c.hunger + 0.5);
      end if;
      dist := sqrt((nx - c.to_x) ^ 2 + (ny - c.to_y) ^ 2);
      secs := greatest(0.2, dist / greatest(0.1, pace));
      c.from_x := c.to_x; c.from_y := c.to_y;
      c.to_x := nx; c.to_y := ny;
      c.leg_at := c.until;
      c.leg_ends := c.leg_at + make_interval(secs => secs);
      c.until := c.leg_ends + make_interval(secs => wild_rest() + hash_tile(p_id, n, 11001) * wild_rest_spread());
    end loop;
    -- Forty legs is as far back as anybody can be bothered to walk. Past that
    -- it is where it got to and the clock catches up with it, which is all
    -- anybody arriving could tell anyway.
    if c.until <= now() then
      c.from_x := c.to_x; c.from_y := c.to_y;
      c.leg_at := now(); c.leg_ends := now();
      c.until := now() + make_interval(secs => 1 + hash_tile(p_id, c.leg, 11001) * 5);
    end if;
  elsif c.mode = 'active' and c.keeper is not null then
    -- A companion is wherever its keeper is; following is not a walk of its own.
    select p.x, p.y into home from player p where p.world_id = p_world and p.uid = c.keeper;
    if found then
      c.from_x := home.x; c.from_y := home.y; c.to_x := home.x; c.to_y := home.y;
      c.leg_at := now(); c.leg_ends := now(); c.until := now();
    end if;
  elsif c.mode = 'stored' then
    -- Kept at the token: it stands by the token.
    select dd.x + 0.5 as x, dd.y + 1.5 as y into home from deed dd where dd.world_id = p_world and dd.founded_by = c.keeper;
    if found then
      c.from_x := home.x; c.from_y := home.y; c.to_x := home.x; c.to_y := home.y;
      c.leg_at := now(); c.leg_ends := now(); c.until := now();
    end if;
  end if;

  update creature set
      from_x = c.from_x, from_y = c.from_y, to_x = c.to_x, to_y = c.to_y,
      leg_at = c.leg_at, leg_ends = c.leg_ends, until = c.until, leg = c.leg,
      health = c.health, hunger = c.hunger, fleece = c.fleece, care = c.care,
      hunting = c.hunting, settled_at = now()
    where world_id = p_world and id = p_id;
  return true;
end $function$;

CREATE OR REPLACE FUNCTION public.errand_step(p_world uuid, p_id integer)
 RETURNS TABLE(gx double precision, gy double precision, want text, wx integer, wy integer)
 LANGUAGE plpgsql
 STABLE
AS $function$
declare c creature; d species_def; dd deed; kind text; rng int;
        v_job record; v_store item; v_crate crate; v_hearth placed; v_spot record;
        v_vessel placed; v_wet record;
begin
  select * into c from creature where world_id = p_world and id = p_id;
  select * into d from species_def where id = c.species;
  select * into dd from deed where world_id = p_world and founded_by = c.keeper;
  if not found then return; end if;
  kind := d.gathers;
  rng := work_range(c);

  if kind = 'mend' then
    -- Nothing is carried: it works at whichever crate holds the worst of it.
    v_store := damaged_in_stores(p_world);
    if v_store.id is null then return; end if;
    select * into v_crate from crate where world_id = p_world and id = v_store.crate;
    gx := crate_centre_x(v_crate); gy := crate_centre_y(v_crate);
    want := null; wx := v_crate.x; wy := v_crate.y;
    return next;
    return;

  elsif kind = 'hod' then
    select * into v_job from wall_needing(p_world, dd.x, dd.y, rng, c.carrying->>'def');
    if v_job.item is null then return; end if;
    if c.carrying->>'def' is distinct from v_job.item then
      v_store := stocked(p_world, v_job.item);
      if v_store.id is null then return; end if;
      select * into v_crate from crate where world_id = p_world and id = v_store.crate;
      gx := crate_centre_x(v_crate); gy := crate_centre_y(v_crate);
      want := v_job.item; wx := v_crate.x; wy := v_crate.y;
    else
      gx := v_job.x + 0.5; gy := v_job.y + 0.5;
      want := null; wx := v_job.x; wy := v_job.y;
    end if;
    return next;
    return;

  elsif kind = 'stoke' then
    v_hearth := cold_hearth(p_world, dd.x, dd.y, rng);
    if v_hearth.id is null then return; end if;
    if c.carrying is null then
      v_store := fuel_in_stores(p_world);
      if v_store.id is null then return; end if;
      select * into v_crate from crate where world_id = p_world and id = v_store.crate;
      gx := crate_centre_x(v_crate); gy := crate_centre_y(v_crate);
      want := v_store.def; wx := v_crate.x; wy := v_crate.y;
    else
      gx := v_hearth.cx; gy := v_hearth.cy;
      want := null; wx := v_hearth.x; wy := v_hearth.y;
    end if;
    return next;
    return;

  elsif kind = 'water' then
    -- Full: to whichever barrel on the deed has room. Empty: to the water.
    if c.carrying->>'def' = 'water_bucket' then
      v_vessel := thirsty_vessel(p_world);
      if v_vessel.id is null then return; end if;
      gx := v_vessel.cx; gy := v_vessel.cy;
      want := null; wx := v_vessel.x; wy := v_vessel.y;
    else
      select * into v_wet from water_source(p_world, dd.x, dd.y, rng, c);
      if v_wet.x is null then return; end if;
      gx := v_wet.gx; gy := v_wet.gy;
      want := null; wx := v_wet.x; wy := v_wet.y;
    end if;
    return next;
    return;

  elsif kind = 'prospect' then
    -- Nothing is carried and nothing is fetched: the work *is* the walk.
    select * into v_spot from unread_ground(p_world, dd.x, dd.y, rng, p_id, c);
    if v_spot.x is null then return; end if;
    gx := v_spot.x + 0.5; gy := v_spot.y + 0.5;
    want := null; wx := v_spot.x; wy := v_spot.y;
    return next;
    return;

  elsif kind = 'plant' then
    if c.carrying->>'def' is distinct from 'sprout' then
      v_store := stocked(p_world, 'sprout');
      if v_store.id is null then return; end if;
      select * into v_crate from crate where world_id = p_world and id = v_store.crate;
      gx := crate_centre_x(v_crate); gy := crate_centre_y(v_crate);
      want := 'sprout'; wx := v_crate.x; wy := v_crate.y;
    else
      select * into v_spot from planting_spot(p_world, dd.x, dd.y, rng);
      if v_spot.x is null then return; end if;
      gx := v_spot.x + 0.5; gy := v_spot.y + 0.5;
      want := null; wx := v_spot.x; wy := v_spot.y;
    end if;
    return next;
    return;
  end if;
  return;
end $function$;

CREATE OR REPLACE FUNCTION public.examine_tile_text(p_world uuid, p_x integer, p_y integer)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
AS $function$
declare v_t int; v_data int; v_out text; v_extra text := ''; b building; v_id int; n int;
begin
  v_t := land_tile(p_world, p_x, p_y);
  v_data := land_data(p_world, p_x, p_y);
  if v_t = 16 then
    v_out := 'You see a '
      || (array['young', 'mature', 'old'])[least(3, greatest(1, tree_age(v_data) + 1))]
      || ' ' || lower((select name from tree_def where id = tree_species(v_data)))
      || ' tree at (' || p_x || ', ' || p_y || ').';
  elsif v_t = 17 then
    v_out := 'You see a ' || lower((select name from bush_def where id = bush_species(v_data)))
      || ' at (' || p_x || ', ' || p_y || ').';
  else
    v_out := 'You see ' || lower((select name from tile_def where id = v_t))
      || ' at (' || p_x || ', ' || p_y || ').';
  end if;
  v_out := v_out || ' Height ' || to_char(centre_height(p_world, p_x, p_y), 'FM990.0')
    || ', slope ' || tile_slope(p_world, p_x, p_y) || '.';
  if has_water(p_world, p_x, p_y) then v_out := v_out || ' Water laps over it.'; end if;

  if is_token(p_world, p_x, p_y) then
    v_extra := v_extra || ' The settlement token of '
      || (deed_at(p_world, p_x, p_y)).name || ' stands here.';
  elsif on_deed(p_world, p_x, p_y) then
    v_extra := v_extra || ' This is part of ' || (deed_at(p_world, p_x, p_y)).name || '.';
  end if;
  v_id := building_at(p_world, p_x, p_y);
  if v_id is not null then
    select * into b from building where world_id = p_world and id = v_id;
    if found then
      v_extra := v_extra || ' It belongs to ' || b.name || ', '
        || case when b.levels = 1 then 'a single-storey building'
                else b.levels || ' storeys tall' end || '.';
    end if;
  end if;
  select count(*) into n from crate c where c.world_id = p_world
    and p_x between c.x and c.x + c.sx - 1 and p_y between c.y and c.y + c.sy - 1;
  if n = 1 then v_extra := v_extra || ' A crate stands here.';
  elsif n > 1 then v_extra := v_extra || ' ' || n || ' crates stand here.'; end if;
  return v_out || v_extra;
end $function$;

CREATE OR REPLACE FUNCTION public.fight_target(p_world uuid, p_id integer)
 RETURNS creature
 LANGUAGE plpgsql
 STABLE
AS $function$
declare c creature; d species_def; dd deed; v_kind text; q creature; v_site record;
        v_rng double precision; v_cx double precision; v_cy double precision;
begin
  select * into c from creature where world_id = p_world and id = p_id;
  if not found then return null; end if;
  select * into dd from deed where world_id = p_world and founded_by = c.keeper;
  -- A posted guard keeps the post's border, not the settlement's: whatever
  -- site it is taking orders from is the ground it answers for.
  select * into v_site from work_site(p_world, c);
  if v_site.x is null then return null; end if;
  select * into d from species_def where id = c.species;
  v_kind := d.gathers;
  v_cx := creature_x(c); v_cy := creature_y(c);
  v_rng := case when v_site.post is not null then v_site.radius
                when v_kind = 'guard' then dd.radius + 1 else v_site.radius end;

  if c.enemy is not null then
    select * into q from creature where world_id = p_world and id = c.enemy;
    if found and q.mode = 'wild'
       and greatest(abs(creature_x(q) - v_site.x), abs(creature_y(q) - v_site.y)) <= v_rng + 4 then
      return q;
    end if;
    return null;
  end if;

  if not fight_trade(v_kind) then
    if c.stance = 'passive' then return null; end if;
    -- A worker that answers for itself works to the border, not to its range.
    v_rng := case when v_site.post is not null then v_site.radius else dd.radius + 1 end;
    if c.stance = 'defensive' then
      if not (c.hurt_at > now() - interval '8 seconds'
              or exists (select 1 from player pl where pl.world_id = p_world
                   and (pl.stats->>'hurtAt')::timestamptz > now() - interval '8 seconds')) then
        return null;
      end if;
      select * into q from creature qq where qq.world_id = p_world and qq.mode = 'wild'
        and greatest(abs(creature_x(qq) - v_site.x), abs(creature_y(qq) - v_site.y)) <= v_rng
        and (c.hurt_by = qq.id
             or exists (select 1 from player pl where pl.world_id = p_world
                  and (pl.stats->>'hurtBy')::int = qq.id
                  and (pl.stats->>'hurtAt')::timestamptz > now() - interval '8 seconds'))
        order by (creature_x(qq) - v_cx) ^ 2 + (creature_y(qq) - v_cy) ^ 2, qq.id
        limit 1;
      if not found then return null; end if;
      return q;
    end if;
  end if;

  q := wild_quarry(p_world, v_site.x, v_site.y, v_rng, v_cx, v_cy);
  if q.id is null then return null; end if;
  return q;
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
begin
  select * into v_dam from creature where world_id = p_world and id = p_id for update;
  if not found or v_dam.due is null or v_dam.due > now() then return 0; end if;
  v_coming := v_dam.unborn;
  update creature set unborn = null, due = null where world_id = p_world and id = p_id;
  if v_coming is null then return 0; end if;
  select * into v_d from species_def where id = v_dam.species;
  v_nx := creature_x(v_dam); v_ny := creature_y(v_dam);
  if v_dam.mode = 'stored' then
    select dd.x + 0.5 as x, dd.y + 1.5 as y into v_home from deed dd where dd.world_id = p_world and dd.founded_by = v_dam.keeper;
    if found then v_nx := v_home.x; v_ny := v_home.y; end if;
  end if;
  v_born := creature_spawn(p_world, v_dam.species, v_nx, v_ny, 'stored', now());
  select array_agg(t) into v_traits from jsonb_array_elements_text(v_coming->'traits') t;
  update creature set traits = coalesce(v_traits, '{}'), sex = v_coming->>'sex',
      hunger = 0.9, care = 0.5
    where world_id = p_world and id = v_born;
  update creature c set health = max_health(c) where c.world_id = p_world and c.id = v_born;
  if v_dam.keeper is not null then
    perform tell(p_world, v_dam.keeper, v_dam.name || ' drops a young ' || lower(v_d.name)
      || ' (' || (v_coming->>'sex') || '): ' || trait_names(coalesce(v_traits, '{}'))
      || '. It is at the token until it is grown.', 'event');
  end if;
  return v_born;
end $function$;

CREATE OR REPLACE FUNCTION public.hitch_up(p_world uuid, p_id integer, p_piece bigint)
 RETURNS boolean
 LANGUAGE plpgsql
AS $function$
declare c creature; p placed; v vehicle_def;
begin
  select * into c from creature where world_id = p_world and id = p_id;
  if not found or c.hitched_to is not null or c.rider is not null then return false; end if;
  select * into p from placed where world_id = p_world and id = p_piece;
  select * into v from vehicle_def where id = p.sub;
  if not found or team_size(p_world, p_piece) >= v.yokes then return false; end if;
  update creature set hitched_to = p_piece, carrying = null, enemy = null, hunting = null,
      -- Fetched out of the token and walked round to the front.
      mode = case when c.mode = 'stored'
                  then case when exists (select 1 from deed where world_id = p_world and founded_by = c.keeper)
                            then 'deed' else 'active' end
                  else c.mode end,
      from_x = p.cx, from_y = p.cy, to_x = p.cx, to_y = p.cy,
      leg_at = now(), leg_ends = now(), settled_at = now()
    where world_id = p_world and id = p_id;
  return true;
end $function$;

CREATE OR REPLACE FUNCTION public.last_refusal(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS text
 LANGUAGE plpgsql
AS $function$
declare p player; pc placed; b bridge; d bridge_def; s bridge_span; c creature; mate creature;
        it item; dye item; bd brew_def; v_kind text; v_short text;
begin
  select * into p from player where world_id = p_world and uid = p_uid;

  if p_action = 'plan_bridge' then
    v_kind := coalesce(p_target->>'material', 'rope');
    return bridge_reason(p_world, v_kind, floor(p.x)::int, floor(p.y)::int,
      (p_target->>'x')::int, (p_target->>'y')::int);

  elsif p_action in ('build_bridge', 'demolish_bridge') then
    select * into b from bridge where world_id = p_world and id = (p_target->>'id')::bigint;
    if not found then return 'It is gone.'; end if;
    select * into d from bridge_def where id = b.kind;
    if p_action = 'build_bridge' then
      select * into s from bridge_span sp where sp.world_id = p_world and sp.bridge = b.id
        and not span_done(sp.needed) order by sp.n limit 1;
      if not found then return 'It is finished.'; end if;
      if tool_ql(p_world, p_uid, d.tool) <= 0 then
        return 'You need a ' || lower((select coalesce(name, d.tool) from item_def where id = d.tool)) || '.';
      end if;
      if sqrt((s.x + 0.5 - p.x) ^ 2 + (s.y + 0.5 - p.y) ^ 2) > 4.5 then
        return 'Work from one end. Walk to the open part of the span.';
      end if;
      select e.key into v_short from jsonb_each(s.needed) e
        where (e.value)::int > 0 and pack_count(p_world, p_uid, e.key) < 1 order by e.key limit 1;
      if v_short is not null then
        return 'That span wants ' || span_wants(s.needed) || '; you are carrying no '
          || lower((select coalesce(name, v_short) from item_def where id = v_short)) || '.';
      end if;
    else
      if sqrt((b.ax + 0.5 - p.x) ^ 2 + (b.ay + 0.5 - p.y) ^ 2) > 4.5
         and sqrt((b.bx + 0.5 - p.x) ^ 2 + (b.by + 0.5 - p.y) ^ 2) > 4.5 then
        return 'Stand at one end of it.';
      end if;
    end if;
    return null;

  elsif p_action in ('sleep', 'set_home') then
    select * into pc from placed where world_id = p_world and id = (p_target->>'id')::bigint
      and kind = 'furniture';
    if not found or not is_bed(pc) then return 'That is not a bed.'; end if;
    if not near_piece(p_world, p_uid, pc) then return 'Stand next to it.'; end if;
    if p_action = 'sleep' and not is_night(p_world) then
      return 'It is ' || world_clock(p_world) || ' and broad daylight. Sleep when it is dark.';
    end if;
    if p_action = 'set_home' and p.home_x = pc.x and p.home_y = pc.y then
      return 'You already wake up here.';
    end if;
    return null;

  elsif p_action in ('pair_creature', 'read_blood') then
    perform creature_settle(p_world, (p_target->>'id')::int);
    perform herd_settle(p_world);
    c := target_creature(p_world, p_target);
    if c.world_id is null then return 'It is gone.'; end if;
    if p_action = 'read_blood' then return null; end if;
    if not exists (select 1 from deed where world_id = p_world and founded_by = p_uid) then
      return 'Breeding is settled work. Found a settlement first: the young one goes to the token.';
    end if;
    if not creature_in_reach(p_world, p_uid, c, 2.4) then return 'Stand next to ' || c.name || '.'; end if;
    if c.due is not null then return c.name || ' is already in young.'; end if;
    mate := mate_for(p_world, c);
    if mate.id is null then
      return 'There is no ' || lower((select name from species_def where id = c.species))
        || ' of the other sex within ' || round(pair_range()) || ' tiles. ' || c.name
        || ' is ' || c.sex || '.';
    end if;
    return pair_refuses(p_world, c, mate);

  elsif p_action in ('dye_item', 'strip_dye') then
    select * into it from item where world_id = p_world and id = (p_target->>'uid')::bigint
      and holder = 'player' and holder_uid = p_uid;
    if p_action = 'dye_item' then
      if not found then return 'It is gone.'; end if;
      if not takes_dye(it.def) then return 'Nothing will take on that.'; end if;
      dye := pick_dye(p_world, p_uid);
      if dye.id is null then
        return 'You have no dye. Boil one out of berries, acorns or herbs with a bucket of lye.';
      end if;
      if it.dye = (select id from dye_def where name = dye.extra) then
        return 'It is ' || (select word from dye_def where name = dye.extra) || ' already.';
      end if;
    else
      if not found or it.dye is null then return 'It has taken no colour.'; end if;
      if pack_count(p_world, p_uid, 'lye_bucket') <= 0 then
        return 'You need a bucket of lye to strip it.';
      end if;
    end if;
    return null;

  elsif p_action = 'start_brew' then
    select * into bd from brew_def where id = p_target->>'brew';
    if not found then return 'Choose what to brew.'; end if;
    select * into pc from placed where world_id = p_world and id = (p_target->>'id')::bigint
      and kind = 'furniture';
    return brew_reason(p_world, p_uid, pc, bd);
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
                  || coalesce((select name from deed where world_id = p_world and founded_by = p_uid), 'your settlement') || '.' end, 'system');
      perform skill_raise(p_world, p_uid, 'taming', 0.7);
      perform skill_raise(p_world, p_uid, 'soul_strength', 0.4);
    else
      -- It refused, but it stayed for the offering, and that is worth
      -- something to the next one.
      update creature set coaxed = coaxed + 1, coaxed_at = now()
        where world_id = p_world and id = c.id returning * into c;
      warm := coax_bonus(c);
      perform tell(p_world, p_uid, 'The ' || lower(d.name) || ' '
        || replace(d.tame_fail, '{food}', material_name(food, 1)) || '.'
        || case when warm > 0 then ' It is ' ||
             case when warm >= 0.12 then 'as used to you as it will get' else 'growing used to you' end
             || ': ' || to_char(warm * 100, 'FM990') || '% readier than the first time.'
           else '' end, 'event');
      perform skill_raise(p_world, p_uid, 'taming', 0.35);
      perform skill_raise(p_world, p_uid, 'soul_strength', 0.2);
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
    gained := skill_raise(p_world, p_uid, 'animal_husbandry', 0.4);
    perform tell(p_world, p_uid, case when before < 0.12 and c.care >= 0.12
        then 'You work the dust out of ' || c.name || '''s coat. It leans into the brush. ('
        else 'You brush ' || c.name || ' down. (' end || care_word(c.care) || ')', 'event');

  elsif p_action = 'shear' then
    -- A full fleece is three, a half-grown one is one, and quality follows the fleece.
    n := greatest(1, round(c.fleece * case when coalesce(d.shear_yield, 'wool') = 'wool' then 3 else 6 end)::int);
    made_ql := greatest(1, least(100, 15 + c.fleece * 45 + skill_of(p_world, p_uid, 'tailoring') * 0.4));
    perform give(p_world, p_uid, coalesce(d.shear_yield, 'wool'), n, made_ql);
    update creature set fleece = 0 where world_id = p_world and id = c.id;
    perform skill_raise(p_world, p_uid, 'tailoring', 0.4);
    perform skill_raise(p_world, p_uid, 'taming', 0.1);
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
    perform skill_raise(p_world, p_uid, 'farming', 0.3);
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
      || (select name from deed where world_id = p_world and founded_by = p_uid) || '.', 'system');

  elsif p_action = 'assign_deed' then
    select * into dd from deed where world_id = p_world;
    update creature set mode = 'deed', keeper = p_uid, phase = 'idle', job = d.gathers,
        work_x = null, work_y = null, carrying = null,
        from_x = case when c.mode = 'stored' then dd.x + 0.5 else creature_x(c) end,
        from_y = case when c.mode = 'stored' then dd.y + 1.5 else creature_y(c) end,
        to_x = case when c.mode = 'stored' then dd.x + 0.5 else creature_x(c) end,
        to_y = case when c.mode = 'stored' then dd.y + 1.5 else creature_y(c) end,
        leg_at = now(), leg_ends = now(), until = now(), settled_at = now()
      where world_id = p_world and id = c.id;
    perform tell(p_world, p_uid, c.name || ' will '
      || coalesce((select plain from gather_def where id = d.gathers), 'stay around the settlement')
      || ' within ' || work_range(c) || ' tiles of the token and bring what it finds to the crate.', 'system');

  elsif p_action = 'release_creature' then
    -- Blood takes generations to build and a moment to walk away.
    update creature set mode = 'wild', stance = 'passive', keeper = null,
        name = d.name, coaxed = 0, coaxed_at = null, until = now()
      where world_id = p_world and id = c.id;
    perform tell(p_world, p_uid, 'The ' || lower(d.name) || ' ' || d.leaves || '.', 'system');
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
      and (nullif(p_target->>'uid', '') is null or id = (p_target->>'uid')::bigint)
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
    perform skill_raise(p_world, p_uid, 'taming', 1.1);
    if not v_clean then
      perform tell(p_world, p_uid, 'The ' || lower(s.name)
        || ' thrashes and you cannot get a hand on it. It is still held.', 'error');
      return;
    end if;
    update placed set caught = null, bait = null, bait_ql = null where id = p.id;
    select * into dd from deed where world_id = p_world and founded_by = p_uid;
    if not exists (select 1 from creature q where q.world_id = p_world and q.mode = 'active'
                     and q.keeper = p_uid) then
      update creature set trapped = null, mode = 'active', keeper = p_uid, until = now()
        where world_id = p_world and id = c.id;
      perform tell(p_world, p_uid, 'You get the noose off the ' || lower(s.name)
        || ' and it stays. It comes with you.', 'event');
    elsif dd.world_id is not null then
      update creature set trapped = null, mode = 'stored', keeper = p_uid,
          from_x = dd.x + 0.5, from_y = dd.y + 1.5, to_x = dd.x + 0.5, to_y = dd.y + 1.5,
          leg_at = now(), leg_ends = now(), until = now(), settled_at = now()
        where world_id = p_world and id = c.id;
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
    perform skill_raise(p_world, p_uid, 'fishing', 0.5);
    perform tell(p_world, p_uid, 'You lift the creel and tip it out: ' || v_names || '.', 'event');

  elsif p_action = 'pick_up_trap' then
    if p.bait is not null then perform give(p_world, p_uid, p.bait, 1, coalesce(p.bait_ql, 20)); end if;
    update item set holder = 'player', holder_uid = p_uid, placed = null
      where holder = 'trap' and placed = p.id;
    v_back := give(p_world, p_uid, p.sub, 1, p.ql, p.material);
    update item set dmg = trap_dmg(p) where id = v_back;
    perform tell(p_world, p_uid, 'You take the ' || lower(trap_name(p)) || ' up'
      || case when p.bait is not null then ' and pocket the bait' else '' end || '.', 'event');
    delete from placed where id = p.id;
    perform land_announce(p_world, p.x, p.y);
  end if;
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
      and (nullif(p_target->>'uid', '') is null or id = (p_target->>'uid')::bigint)
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
    if not exists (select 1 from deed where world_id = p_world and founded_by = p_uid)
       and exists (select 1 from creature q where q.world_id = p_world and q.mode = 'active'
                     and q.keeper = p_uid) then
      return 'You have a companion at your side and no settlement to send this one to.';
    end if;

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

CREATE OR REPLACE FUNCTION public.post_settle(p_id bigint)
 RETURNS boolean
 LANGUAGE plpgsql
AS $function$
declare p placed; v_dmg double precision; c creature; dd deed;
begin
  select * into p from placed where id = p_id and kind = 'post' for update;
  if not found then return false; end if;
  v_dmg := post_dmg(p);
  if v_dmg < 100 then
    update placed set dmg = v_dmg, since = now() where id = p_id;
    return false;
  end if;
  select * into dd from deed where world_id = p.world_id and founded_by = p.made_by;
  for c in select * from creature where world_id = p.world_id and post = p_id loop
    if dd.world_id is null then
      update creature set post = null, mode = 'wild', phase = 'idle' where world_id = c.world_id and id = c.id;
    else
      update creature set post = null, phase = 'idle',
          from_x = dd.x + 0.5, from_y = dd.y + 1.5, to_x = dd.x + 0.5, to_y = dd.y + 1.5,
          leg_at = now(), leg_ends = now(), until = now(), settled_at = now()
        where world_id = c.world_id and id = c.id;
    end if;
    if c.keeper is not null then
      perform tell(p.world_id, c.keeper, 'The ' || lower(post_name(p))
        || ' has rotted through and gone over. ' || c.name || ' comes home.', 'system');
    end if;
  end loop;
  delete from placed where id = p_id;
  return true;
end $function$;

CREATE OR REPLACE FUNCTION public.sitting_worth(p_world uuid, p_uid uuid)
 RETURNS TABLE(gain double precision, said text)
 LANGUAGE plpgsql
 STABLE
AS $function$
declare p player; tx int; ty int; quiet double precision := 1; h double precision; on_deed boolean;
begin
  select * into p from player where world_id = p_world and uid = p_uid;
  tx := floor(p.x)::int; ty := floor(p.y)::int;
  said := 'You sit down and let the day go past.';
  on_deed := exists (select 1 from deed d where d.world_id = p_world and d.founded_by = p_uid
    and abs(tx - d.x) <= d.radius and abs(ty - d.y) <= d.radius);
  if on_deed then
    quiet := quiet * 0.7;
    said := 'You sit in your own yard. It is hard to empty your head where there is so much to do.';
  end if;
  -- High, wild ground is what the paths are walked on.
  h := centre_height(p_world, tx, ty);
  if h > 60 then
    quiet := quiet * 1.6;
    said := 'You sit where the ground runs out and the air is thin, and the day goes past a long way below.';
  elsif h > 25 and not on_deed then
    quiet := quiet * 1.25;
    said := 'You sit on the high ground with your back to a stone.';
  end if;
  if has_water(p_world, tx, ty) then
    quiet := quiet * 1.3;
    said := 'You sit with your feet in the water and let it go past.';
  end if;
  gain := 1.5 * quiet;
  return next;
end $function$;

CREATE OR REPLACE FUNCTION public.work_site(p_world uuid, c creature)
 RETURNS TABLE(x integer, y integer, radius integer, post bigint)
 LANGUAGE plpgsql
 STABLE
AS $function$
declare p placed; dd deed;
begin
  if c.post is not null then
    select * into p from placed where id = c.post and kind = 'post';
    if found then
      x := p.x; y := p.y;
      radius := least(work_range(c), post_radius(p.ql));
      post := p.id;
      return next;
      return;
    end if;
  end if;
  select * into dd from deed where world_id = p_world and founded_by = c.keeper;
  if not found then return; end if;
  x := dd.x; y := dd.y; radius := work_range(c); post := null;
  return next;
end $function$;

CREATE OR REPLACE FUNCTION public.worker_settle(p_world uuid, p_id integer)
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
declare c creature; d species_def; dd deed; cr crate; kind text; guard int := 0; done int := 0;
        spot record; stand record; step record; pace double precision; dist double precision;
        secs double precision; load jsonb; cx double precision; cy double precision;
        ax double precision; ay double precision; v_foe creature; v_corpse item;
        v_step record; v_site record;
begin
  select * into c from creature where world_id = p_world and id = p_id for update;
  if not found or c.mode <> 'deed' then return 0; end if;
  select * into dd from deed where world_id = p_world and founded_by = c.keeper;
  /*
   * Where it takes its orders from. A post stands in for a settlement, and a
   * worker with neither has nobody to take them from at all.
   */
  select * into v_site from work_site(p_world, c);
  if v_site.x is null then
    update creature set mode = 'wild', phase = 'idle', job = null, post = null
      where world_id = p_world and id = p_id;
    return 0;
  end if;
  select * into d from species_def where id = c.species;
  kind := d.gathers;
  cr := deed_crate(p_world, c.keeper);
  pace := d.speed * (age_row(c.born)).speed * trait_mul(c.traits, 'speed')
          * (1 + greatest(1, task_skill(c)) / 500);

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

    if fight_trade(kind) and c.phase = 'idle' and c.carrying is not null and cr.id is not null then
      ax := crate_centre_x(cr); ay := crate_centre_y(cr);
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
          c.until := c.until + make_interval(secs => fight_blow(kind));
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
        c.until := c.until + make_interval(secs => work_duration(task_skill(c)) / trait_mul(c.traits, 'work'));

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
      c.until := c.until + make_interval(secs => work_duration(task_skill(c)) / trait_mul(c.traits, 'work'));

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
      if load is null or cr.id is null then
        c.phase := 'idle';
        c.leg_at := c.until; c.leg_ends := c.until;
        c.until := c.until + interval '1 second';
      else
        ax := crate_centre_x(cr); ay := crate_centre_y(cr);
        dist := sqrt((ax - cx) ^ 2 + (ay - cy) ^ 2);
        secs := greatest(0.2, dist / greatest(0.1, pace));
        c.from_x := cx; c.from_y := cy; c.to_x := ax; c.to_y := ay;
        c.leg_at := c.until; c.leg_ends := c.leg_at + make_interval(secs => secs);
        c.until := c.leg_ends;
        c.phase := 'home';
      end if;

    elsif c.phase = 'home' then
      if c.carrying is not null and crate_add(p_world, cr.id, c.carrying->>'def',
          (c.carrying->>'count')::int, (c.carrying->>'ql')::double precision, c.carrying->>'extra') then
        c.carrying := null;
      end if;
      c.phase := 'idle';
      c.leg_at := c.until; c.leg_ends := c.until;
      c.until := c.until + interval '1 second';

    else
      select * into spot from find_work_tile(p_world, v_site.x, v_site.y, v_site.radius, kind, c);
      if spot.x is null then
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
        if kind in ('woodcut', 'fish') then
          select * into stand from beside_tile(p_world, spot.x, spot.y);
          if stand.x is null then
            c.until := c.until + interval '4 seconds';
            continue;
          end if;
          ax := stand.x + 0.5; ay := stand.y + 0.5;
        else
          ax := spot.x + 0.5; ay := spot.y + 0.5;
        end if;
        c.work_x := spot.x; c.work_y := spot.y;
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
      enemy = c.enemy, settled_at = now()
    where world_id = p_world and id = p_id;
  return done;
end $function$;

CREATE OR REPLACE FUNCTION public.settlement_refusal(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS text
 LANGUAGE plpgsql
AS $function$
declare dd deed; p placed; it item; c creature; v_name text;
begin
  if p_action in ('upgrade_deed', 'disband_deed', 'rename_deed') then
    select * into dd from deed where world_id = p_world and founded_by = p_uid;
    if not found then return 'You have no settlement.'; end if;
    if dd.founded_by is distinct from p_uid then return 'That is not your settlement.'; end if;
    if p_action = 'upgrade_deed' then return upgrade_reason(p_world, p_uid); end if;
    if p_action = 'rename_deed'
       and nullif(btrim(coalesce(p_target->>'name', '')), '') is null then
      return 'Choose a name.';
    end if;
    return null;
  end if;

  if p_action = 'place_post' then
    select * into it from item where world_id = p_world and holder = 'player' and holder_uid = p_uid
      and def = 'work_post' and not locked
      and (nullif(p_target->>'uid', '') is null or id = (p_target->>'uid')::bigint)
      order by id limit 1;
    if not found then return 'You have no work post to drive in.'; end if;
    return post_place_reason(p_world, (p_target->>'x')::int, (p_target->>'y')::int,
      coalesce((p_target->>'sx')::int, 0), coalesce((p_target->>'sy')::int, 0));
  end if;

  -- Everything else is asked of a post, so the post is brought up to date
  -- before it is asked: one nobody has looked at for a day is not there.
  perform post_settle((p_target->>'id')::bigint);
  select * into p from placed where world_id = p_world and id = (p_target->>'id')::bigint
    and kind = 'post';
  if not found then return 'It is gone.'; end if;
  if not near_piece(p_world, p_uid, p) then return 'Stand at the post.'; end if;

  if p_action = 'assign_post' then
    if exists (select 1 from creature q where q.world_id = p_world and q.post = p.id) then
      return 'Something is already working out of it.';
    end if;
    select * into c from creature where world_id = p_world and id = (p_target->>'creature')::int;
    if not found then return 'Choose a wildermon.'; end if;
    if c.mode = 'wild' then return c.name || ' is not yours to set to work.'; end if;
    if not worker_job_ported((select gathers from species_def where id = c.species)) then
      return 'Nobody has taught this island what '
        || (select plain from gather_def where id = (select gathers from species_def where id = c.species))
        || ' looks like yet.';
    end if;
  elsif p_action = 'unassign_post' then
    if not exists (select 1 from creature q where q.world_id = p_world and q.post = p.id) then
      return 'Nothing is working out of it.';
    end if;
  end if;
  return null;
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
    -- Everything kept here runs wild, and what it was carrying goes on the
    -- ground where it stood rather than with it.
    for c in select * from creature where world_id = p_world and keeper = p_uid and mode in ('stored', 'deed') loop
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
    delete from deed where world_id = p_world;
    perform tell(p_world, p_uid, dd.name || ' is disbanded. '
      || v_freed || case when v_freed = 1 then ' wildermon runs' else ' wildermon run' end
      || ' wild and ' || v_tipped
      || case when v_tipped = 1 then ' thing is' else ' things are' end
      || ' tipped out where the crate stood.', 'system');
    perform land_announce(p_world, dd.x, dd.y);

  elsif p_action = 'place_post' then
    select * into it from item where world_id = p_world and holder = 'player' and holder_uid = p_uid
      and def = 'work_post' and not locked
      and (nullif(p_target->>'uid', '') is null or id = (p_target->>'uid')::bigint)
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
    perform tell(p_world, p_uid, c.name || ' will '
      || coalesce((select g.plain from gather_def g
                   where g.id = (select gathers from species_def where id = c.species)),
                  'keep to the post')
      || ' within ' || least(work_range(c), post_radius(p.ql))
      || ' tiles of the post while it stands. (' || post_state(p) || ')', 'system');

  elsif p_action = 'unassign_post' then
    select * into c from creature where world_id = p_world and post = p.id limit 1;
    if not found then return; end if;
    select * into dd from deed where world_id = p_world and founded_by = c.keeper;
    update creature set post = null, phase = 'idle',
        from_x = coalesce(dd.x + 0.5, p.cx), from_y = coalesce(dd.y + 1.5, p.cy),
        to_x = coalesce(dd.x + 0.5, p.cx), to_y = coalesce(dd.y + 1.5, p.cy),
        leg_at = now(), leg_ends = now(), until = now(), settled_at = now()
      where world_id = p_world and id = c.id;
    perform tell(p_world, p_uid, c.name || ' is called off the post.', 'system');
  end if;
end $function$;

CREATE OR REPLACE FUNCTION public.perform_deed(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare p player; tx int; ty int; nm text; made int;
begin
  select * into p from player where world_id = p_world and uid = p_uid;
  tx := floor(p.x)::int; ty := floor(p.y)::int;
  nm := nullif(btrim(coalesce(p_target->>'name', '')), '');
  if nm is null then nm := 'Homestead'; end if;
  if not consume(p_world, p_uid, 'deed_stake', 1) then return; end if;
  insert into deed (world_id, name, x, y, radius, level, founded_by)
  values (p_world, left(nm, 32), tx, ty, deed_radius(1), 1, p_uid)
  on conflict do nothing;
  made := place_deed_crate(p_world, p_uid);
  perform tell(p_world, p_uid, 'You found the settlement of ' || left(nm, 32)
    || '. The land ' || (deed_radius(1) * 2 + 1) || ' tiles across around the token is yours to build on.'
    || case when made is null then '' else ' A deed crate stands beside the token.' end, 'system');
end $function$;

CREATE OR REPLACE FUNCTION public.work_ability(p_world uuid, p_uid uuid, p_ability text)
 RETURNS text
 LANGUAGE plpgsql
AS $function$
declare p player; n int; d deed;
begin
  select * into p from player where world_id = p_world and uid = p_uid;
  if p_ability = 'refresh' then
    update player set stats = jsonb_set(jsonb_set(stats, '{hunger}', '1'), '{thirst}', '1')
      where world_id = p_world and uid = p_uid;
    return 'You are neither hungry nor thirsty, and cannot say when that happened.';

  elsif p_ability = 'mendflesh' then
    n := jsonb_array_length(p.wounds);
    update player set wounds = '[]'::jsonb,
        stats = jsonb_set(stats, '{health}',
          to_jsonb(least(1, coalesce((stats->>'health')::double precision, 1) + 0.4)))
      where world_id = p_world and uid = p_uid;
    return case when n = 1 then 'The wound closes and the ache goes with it.'
                when n > 1 then 'All ' || n || ' of them close and the ache goes with them.'
                else 'There was nothing to mend, and you feel better anyway.' end;

  elsif p_ability = 'sense' then
    n := sense_rock(p_world, p_uid, 15);
    return case when n > 0 then 'The ground gives up what is in it: ' || n
                  || ' seams within fifteen tiles, marked.'
                else 'There is nothing under this ground but rock.' end;

  elsif p_ability = 'recall' then
    select * into d from deed where world_id = p_world and founded_by = p_uid;
    if not found then return 'You have nowhere to be recalled to.'; end if;
    update player set x = d.x + 0.5, y = d.y + 1.5, moved_at = now()
      where world_id = p_world and uid = p_uid;
    perform drag_along(p_world, p_uid, d.x + 0.5, d.y + 1.5);
    return 'You are standing at the token of ' || d.name
      || ', and the walk is simply not in your legs.';

  elsif p_ability = 'secondwind' then
    update player set stats = jsonb_set(stats, '{stamina}', '1')
      where world_id = p_world and uid = p_uid;
    return 'Your wind comes back all at once.';

  elsif p_ability = 'fury' then
    update player set fury_until = now() + interval '30 seconds'
      where world_id = p_world and uid = p_uid;
    return 'For half a minute nothing you swing at is going to enjoy it.';
  end if;
  return 'Nothing happens.';
end $function$;

CREATE OR REPLACE FUNCTION public.deed_crate(p_world uuid, p_uid uuid)
 RETURNS crate
 LANGUAGE sql
 STABLE
AS $function$
  select c.* from crate c, my_deed(p_world, p_uid) d
   where c.world_id = p_world and c.deed
     and abs(c.x - d.x) <= d.radius and abs(c.y - d.y) <= d.radius
   order by c.id limit 1
$function$;

CREATE OR REPLACE FUNCTION public.worker_cap(p_world uuid, p_uid uuid)
 RETURNS integer
 LANGUAGE sql
 STABLE
AS $function$
  select coalesce((select level from deed where world_id = p_world and founded_by = p_uid), 0)
$function$;

CREATE OR REPLACE FUNCTION public.workers_on_deed(p_world uuid, p_uid uuid)
 RETURNS integer
 LANGUAGE sql
 STABLE
AS $function$
  select count(*)::int from creature
   where world_id = p_world and keeper = p_uid and mode = 'deed'
$function$;

CREATE OR REPLACE FUNCTION public.place_deed_crate(p_world uuid, p_uid uuid)
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
declare d deed; spot record; new_id int;
begin
  select * into d from deed where world_id = p_world and founded_by = p_uid;
  if not found or (deed_crate(p_world, p_uid)).id is not null then return null; end if;
  select gx, gy into spot from (values (1, 0), (0, 1), (-1, 0), (0, -1), (1, 1)) as v(dx, dy),
    lateral (select d.x + v.dx as gx, d.y + v.dy as gy) q
  where in_bounds(p_world, q.gx, q.gy) and passable(p_world, q.gx, q.gy)
    and not has_water(p_world, q.gx, q.gy)
    and building_at(p_world, q.gx, q.gy) is null
    and not exists (select 1 from crate cr where cr.world_id = p_world and cr.x = q.gx and cr.y = q.gy)
  limit 1;
  if not found then return null; end if;
  select coalesce(max(id), 0) + 1 into new_id from crate where world_id = p_world;
  insert into crate (world_id, id, kind, x, y, sx, sy, deed) values (p_world, new_id, 'plank', spot.gx, spot.gy, 1, 1, true);
  return new_id;
end $function$;

CREATE OR REPLACE FUNCTION public.upgrade_reason(p_world uuid, p_uid uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
AS $function$
declare dd deed; v_next int; v_missing text;
begin
  select * into dd from deed where world_id = p_world and founded_by = p_uid;
  if not found then return 'You have no settlement.'; end if;
  if dd.level >= max_deed_level() then
    return dd.name || ' is as grand as a settlement gets.';
  end if;
  v_next := dd.level + 1;
  select string_agg(w.label, ', ' order by w.label) into v_missing
    from upgrade_wants(p_world, p_uid, v_next) w where not w.met;
  if v_missing is not null then return 'Still wanted: ' || v_missing || '.'; end if;
  return null;
end $function$;

CREATE OR REPLACE FUNCTION public.upgrade_wants(p_world uuid, p_uid uuid, p_level integer)
 RETURNS TABLE(label text, met boolean)
 LANGUAGE plpgsql
 STABLE
AS $function$
declare dd deed;
begin
  select * into dd from deed where world_id = p_world and founded_by = p_uid;
  if not found then return; end if;
  if p_level = 2 then
    label := 'a crate on the deed';
    met := exists (select 1 from crate c where c.world_id = p_world and abs(c.x - dd.x) <= dd.radius and abs(c.y - dd.y) <= dd.radius);
    return next;
    label := 'a campfire on the deed';
    met := exists (select 1 from placed p where p.world_id = p_world and p.kind = 'campfire'
                     and abs(p.x - dd.x) <= dd.radius and abs(p.y - dd.y) <= dd.radius);
    return next;
  elsif p_level = 3 then
    label := 'a stone smelter on the deed';
    met := exists (select 1 from placed p where p.world_id = p_world and p.kind = 'smelter'
                     and abs(p.x - dd.x) <= dd.radius and abs(p.y - dd.y) <= dd.radius);
    return next;
  elsif p_level = 4 then
    label := 'an anvil set down on the deed';
    met := exists (select 1 from placed p where p.world_id = p_world and p.kind = 'anvil'
                     and abs(p.x - dd.x) <= dd.radius and abs(p.y - dd.y) <= dd.radius);
    return next;
  elsif p_level = 5 then
    label := 'a building with every ground-floor wall up';
    met := exists (select 1 from building b
                   where b.world_id = p_world and level_complete(p_world, b.id, 0)
                     and exists (select 1 from building_tile t where t.world_id = p_world
                                   and t.building = b.id and on_deed(p_world, t.x, t.y)));
    return next;
    label := '3 wildermon working the deed';
    met := workers_on_deed(p_world, p_uid) >= 3;
    return next;
  end if;
end $function$;

/**
 * Founding, now that there can be more than one.
 *
 * Two rules where there was one. You may hold a settlement, singular — which
 * is what the old message claimed and the old key actually enforced by holding
 * one for the whole island. And it may not touch anybody else's, because
 * `deed_at` has to be able to answer "whose ground is this" with one name, and
 * two settlements laid over each other make every answer it could give wrong.
 */
create or replace function deed_refusal(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
  returns text language plpgsql stable as $$
declare p player; tx int; ty int; want int := 5; other deed;
begin
  select * into p from player where world_id = p_world and uid = p_uid;
  tx := floor(p.x)::int; ty := floor(p.y)::int;
  if exists (select 1 from deed d where d.world_id = p_world and d.founded_by = p_uid) then
    return 'You already hold a settlement. Disband it first.';
  end if;
  if pack_count(p_world, p_uid, 'deed_stake') <= 0 then return 'You have no deed stake.'; end if;
  if tx - want < 0 or ty - want < 0
     or not in_bounds(p_world, tx + want, ty + want) then
    return 'Too close to the edge of the world.';
  end if;
  if has_water(p_world, tx, ty) then return 'The token must stand on dry land.'; end if;
  if not passable(p_world, tx, ty) then return 'The token needs a clear tile.'; end if;
  -- Two squares overlap when their centres are closer than the sum of their
  -- reaches, on either axis.
  select * into other from deed d
   where d.world_id = p_world
     and abs(tx - d.x) <= want + d.radius
     and abs(ty - d.y) <= want + d.radius
   order by d.founded_at limit 1;
  if found then
    return other.name || ' stands too close. Settlements may not overlap, and yours would '
        || 'reach ' || want || ' tiles from here. Walk further out.';
  end if;
  return null;
end $$;

/**
 * What is on the ground here — and whose settlement it is.
 *
 * `deed` used to be the island's one settlement, handed to everybody whatever
 * their distance from it. The browser then lit it: `vision.ts` reveals your
 * own settlement whatever the hour and however far away, which is right for
 * your own and made a stranger's homestead a hole cut in your fog of war.
 * That is the bug as it was reported — "I can see Farce's homestead as if my
 * own active visibility" — and it was this line that did it.
 *
 * So `deed` is now yours or nothing, which is what the browser always thought
 * it was. Other people's come back separately in `deeds`, and only when you
 * are near enough to be standing in one: a border you can see from inside it
 * is worth drawing, because it tells you why the ground will not let you
 * build. Nothing in `deeds` lights anything.
 */
create or replace function rpc_ground(p_world uuid, p_range double precision default 40)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); p player;
begin
  if me is null then raise exception 'not signed in'; end if;
  if too_fast(me) then raise exception 'you are asking too quickly; slow down'; end if;
  select * into p from player where world_id = p_world and uid = me;
  if not found then raise exception 'you are not on this island'; end if;
  return jsonb_build_object(
    'placed', coalesce((select jsonb_agg(
        (to_jsonb(pl) - 'world_id' - 'made_by' - 'since' - 'made_at' - 'cx' - 'cy')
        || jsonb_build_object('fuel', placed_fuel(pl), 'ash', placed_ash(pl),
                              'lit', placed_lit(pl), 'mine', coalesce(pl.made_by = me, false))
        order by pl.id)
      from placed pl
      where pl.world_id = p_world
        and greatest(abs(pl.cx - p.x), abs(pl.cy - p.y)) <= p_range), '[]'::jsonb),
    'crates', coalesce((select jsonb_agg((to_jsonb(c) - 'world_id') order by c.id)
      from crate c
      where c.world_id = p_world
        and greatest(abs(c.x + 0.5 - p.x), abs(c.y + 0.5 - p.y)) <= p_range), '[]'::jsonb),
    'deed', (select jsonb_build_object(
        'name', d.name, 'x', d.x, 'y', d.y, 'radius', d.radius, 'level', d.level, 'mine', true)
      from my_deed(p_world, me) d where d.world_id is not null),
    'deeds', coalesce((select jsonb_agg(jsonb_build_object(
        'name', d.name, 'x', d.x, 'y', d.y, 'radius', d.radius, 'level', d.level,
        'mine', false, 'holder', account_name(d.founded_by)) order by d.founded_at)
      from deed d
      where d.world_id = p_world and d.founded_by <> me
        and greatest(abs(d.x + 0.5 - p.x), abs(d.y + 0.5 - p.y)) <= p_range + d.radius),
      '[]'::jsonb));
end $$;

select private.lock_doors();
