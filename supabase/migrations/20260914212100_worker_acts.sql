-- Setting one to work, and the settle that does the work.

/** The trades this island knows how to have done for it. */
create or replace function worker_job_ported(p_kind text) returns boolean
  language sql immutable as $$
  select p_kind in ('forage', 'botanize', 'woodcut', 'mine', 'quarry',
                    'sand', 'clay', 'peat', 'reed', 'fish', 'farm')
$$;

create or replace function creature_action(p_action text) returns boolean language sql immutable as $$
  select p_action in ('examine_creature', 'tame', 'feed', 'groom', 'shear', 'milk_creature',
                      'set_stance', 'rename_creature', 'take_creature', 'store_creature',
                      'release_creature', 'assign_deed')
$$;

/**
 * Settling a creature now settles a worker's day as well.
 *
 * The body first — hunger, wounds closing, fleece — and written down, because
 * the work reads the row back. Then the trips, for whichever of them is on the
 * deed rather than out in the country.
 */
create or replace function creature_settle(p_world uuid, p_id int) returns boolean
  language plpgsql as $$
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
  if elapsed <= 0 then
    if c.mode = 'deed' then perform worker_settle(p_world, p_id); end if;
    return false;
  end if;

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
    pace := d.speed * a.speed * trait_mul(c.traits, 'speed') * 0.7;
    while c.until <= now() and guard < 40 loop
      guard := guard + 1;
      n := c.leg + 1;
      ok := false;
      for i in 0..7 loop
        nx := c.to_x + (hash_tile(p_id, n, 7001 + i) * 2 - 1) * 4;
        ny := c.to_y + (hash_tile(p_id, n, 9001 + i) * 2 - 1) * 4;
        if creature_tile_ok(p_world, floor(nx)::int, floor(ny)::int)
           and line_clear(p_world, c.to_x, c.to_y, nx, ny) then ok := true; exit; end if;
      end loop;
      c.leg := n;
      if not ok then
        c.from_x := c.to_x; c.from_y := c.to_y;
        c.leg_at := c.until; c.leg_ends := c.until;
        c.until := c.until + interval '2 seconds';
        continue;
      end if;
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
      c.until := c.leg_ends + make_interval(secs => 1 + hash_tile(p_id, n, 11001) * 5);
    end loop;
    if c.until <= now() then
      c.from_x := c.to_x; c.from_y := c.to_y;
      c.leg_at := now(); c.leg_ends := now();
      c.until := now() + make_interval(secs => 1 + hash_tile(p_id, c.leg, 11001) * 5);
    end if;
  elsif c.mode = 'active' and c.keeper is not null then
    select p.x, p.y into home from player p where p.world_id = p_world and p.uid = c.keeper;
    if found then
      c.from_x := home.x; c.from_y := home.y; c.to_x := home.x; c.to_y := home.y;
      c.leg_at := now(); c.leg_ends := now(); c.until := now();
    end if;
  elsif c.mode = 'stored' then
    select dd.x + 0.5 as x, dd.y + 1.5 as y into home from deed dd where dd.world_id = p_world;
    if found then
      c.from_x := home.x; c.from_y := home.y; c.to_x := home.x; c.to_y := home.y;
      c.leg_at := now(); c.leg_ends := now(); c.until := now();
    end if;
  end if;

  update creature set
      from_x = c.from_x, from_y = c.from_y, to_x = c.to_x, to_y = c.to_y,
      leg_at = c.leg_at, leg_ends = c.leg_ends, until = c.until, leg = c.leg,
      health = c.health, hunger = c.hunger, fleece = c.fleece, care = c.care,
      settled_at = now()
    where world_id = p_world and id = p_id;
  if c.mode = 'deed' then perform worker_settle(p_world, p_id); end if;
  return true;
end $$;

/**
 * Founding a settlement stands its crate up again.
 *
 * It was left out when the deed was first ported because nothing needed it.
 * A worker needs it: a beast that has walked out for a log and has nowhere to
 * put it is a beast doing nothing at all.
 */
create or replace function perform_deed(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
  returns void language plpgsql as $$
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
  made := place_deed_crate(p_world);
  perform tell(p_world, p_uid, 'You found the settlement of ' || left(nm, 32)
    || '. The land ' || (deed_radius(1) * 2 + 1) || ' tiles across around the token is yours to build on.'
    || case when made is null then '' else ' A deed crate stands beside the token.' end, 'system');
end $$;

/**
 * A settlement's crate is the settlement's to read.
 *
 * The item policy let you see what you were carrying and what lay on the
 * ground, which was every place an item could be until today. A crate nobody
 * can read is a crate nobody can use, so anybody standing on the island can
 * see what is in its stores — and still not touch them except through a rule.
 */
drop policy if exists item_read on item;
create policy item_read on item for select to authenticated using (
  (holder = 'player' and holder_uid = (select auth.uid()))
  or holder = 'ground'
  or (holder = 'crate' and private.on_island(world_id))
);

select private.lock_doors();
