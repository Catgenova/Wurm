-- Three head to a stretch of country, not one.
--
-- Reported: "wildermon are too rare." One head to a thirty-two tile square is
-- one creature to a thousand tiles, and a thousand tiles is a long walk — so
-- the country between settlements read as empty, which is exactly the half of
-- the island a player spends their time crossing.
--
-- Both sides worked the same figure out from the same shape and each kept its
-- own copy of the numbers in it: `PER_REGION` and `WILD_TARGET` in the
-- browser, a bare 32 and a bare 32 here. Tripling one of those and not the
-- other would have given a solo world and an island different populations on
-- the same ground, and nothing would have said so. So the numbers are the
-- browser's now and come across with the rest of the rulebook —
-- `wild_per_region()` and `wild_floor()` — and this reads them.
--
-- Nothing else moves. What stands up where is still the habitat's business,
-- the island is still stocked a block at a time as somebody walks into it, and
-- what is already alive in a block still counts against its share, so a
-- tripling is three times the ceiling rather than three times the spawning.


CREATE OR REPLACE FUNCTION public.creature_target(p_world uuid)
 RETURNS integer
 LANGUAGE sql
 STABLE
AS $function$
  select greatest(wild_floor(),
                  (ceil(size / 32.0) * ceil(size / 32.0) * wild_per_region())::int)
    from world where id = p_world
$function$;

CREATE OR REPLACE FUNCTION public.creature_stock_block(p_world uuid, p_bx integer, p_by integer)
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
declare v_size int; v_block int := stock_block(); v_want int; v_placed int := 0; v_tries int := 0;
        v_x int; v_y int; v_got text; v_x0 int; v_y0 int; v_w int; v_h int;
        v_alive int; v_site record; v_fresh boolean;
begin
  select w.size into v_size from world w where w.id = p_world;
  if v_size is null then return 0; end if;
  v_x0 := p_bx * v_block;
  v_y0 := p_by * v_block;
  if v_x0 < 0 or v_y0 < 0 or v_x0 >= v_size or v_y0 >= v_size then return 0; end if;

  -- A block is put out once, and looked at again no sooner than restock_every().
  -- Nothing replaced what was killed before this: the browser has topped its
  -- wildlife up every twenty-two seconds since there was wildlife, and the port
  -- of it to the island dropped that half, so country walked through once
  -- emptied for good.
  insert into world_stocked (world_id, bx, by) values (p_world, p_bx, p_by) on conflict do nothing;
  v_fresh := found;
  if not v_fresh then
    update world_stocked s set at = now()
    where s.world_id = p_world and s.bx = p_bx and s.by = p_by
      and s.at <= now() - make_interval(secs => restock_every());
    if not found then return 0; end if;
  end if;

  v_w := least(v_block, v_size - v_x0);
  v_h := least(v_block, v_size - v_y0);
  v_want := (ceil(v_w / 32.0) * ceil(v_h / 32.0) * wild_per_region())::int;
  if v_size <= v_block then v_want := greatest(wild_floor(), v_want); end if;
  -- What is already standing here counts against the target, so a top-up puts
  -- the shortfall out rather than a second block's worth.
  select count(*) into v_alive from creature c
  where c.world_id = p_world and c.mode = 'wild'
    and c.to_x >= v_x0 and c.to_x < v_x0 + v_w and c.to_y >= v_y0 and c.to_y < v_y0 + v_h;
  v_want := v_want - v_alive;
  if v_want <= 0 then return 0; end if;
  while v_placed < v_want and v_tries < v_want * 12 loop
    v_tries := v_tries + 1;
    v_x := v_x0 + floor(random() * v_w)::int;
    v_y := v_y0 + floor(random() * v_h)::int;
    if not creature_tile_ok(p_world, v_x, v_y) then continue; end if;
    if centre_height(p_world, v_x, v_y) < 2 or on_deed(p_world, v_x, v_y) then continue; end if;
    v_got := pick_wild(p_world, v_x, v_y);
    if v_got is null then continue; end if;
    if not suits(p_world, v_got, v_x, v_y) then
      -- The roll says what stands up; the ground says where. Throwing the roll
      -- away because this tile is wrong makes a species as rare as its weight
      -- times the share of the island that suits it — a mola wants metal under
      -- it, metal is a seventh of the ground, and a fifth of a mola is a mola
      -- nobody ever meets. So a place is looked for instead. A monster keeps the
      -- tile it was rolled on: its distance from a deed and from the beach were
      -- settled there.
      if coalesce((select monster from species_def where id = v_got), false) then continue; end if;
      v_tries := v_tries + site_looks()::int;
      select * into v_site from site_for(p_world, v_x0, v_y0, v_w, v_h, v_got, site_looks()::int);
      if v_site.x is null then continue; end if;
      v_x := v_site.x;
      v_y := v_site.y;
    end if;
    -- Born at some point in the past, so the country is not all yearlings.
    perform creature_spawn(p_world, v_got, v_x + 0.5, v_y + 0.5, 'wild',
      now() - make_interval(secs => random() * 6 * 3600 * 1.6));
    v_placed := v_placed + 1;
  end loop;
  return v_placed;
end $function$;

select private.lock_doors();
