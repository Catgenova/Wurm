-- A habitat is where a thing lives, not how rare it is.
--
-- Reported: "with wildermon like mola, their spawn points can be over seams
-- buried, not just exposed. I have yet to see a single mola spawn."
--
-- The first half is already so, on both sides: `suits` asks `bedrock_at`,
-- which is the rock under a tile whether it is bare or under ten feet of
-- soil. Measured on a real island, 159 of the 1127 tiles a creature can stand
-- on suit a mola; barely a tenth of those are bare rock. The ground was never
-- the restriction.
--
-- The stocking loop was. It picks a tile, rolls what stands up on it against
-- the wild table, and *throws the roll away* if that tile is wrong for it. So
-- a species is not as common as its weight says — it is as common as its
-- weight times the share of the island that suits it. Mola's weight is one in
-- thirty of everything wild; metal is a seventh of the ground; the two
-- together make one mola in a hundred and forty, standing only where there is
-- metal, which is the hills. Measured on a 64 island before this change: of
-- every mola rolled, 10% were placed, and mola came out at 0.71% of what was
-- put down against the 3.4% its weight asks for. Crawler 12%, quarra 13%,
-- gorral 10%, and embra and bogga nothing at all.
--
-- So the roll is kept and a place is looked for: `site_for` tries a few tiles
-- in the same block for ground that suits the thing that was rolled. The tries
-- come out of the same budget the loop always had, so a block costs what it
-- cost. A monster keeps the tile it was rolled on, because its distance from
-- the deeds and from the landing beach were settled there.
--
-- And the other half of why the country is empty: nothing ever replaced what
-- was killed. A block is put out once and `world_stocked` remembers it for
-- good, so ground walked through once stays as it was left. The browser has
-- topped its wildlife up every twenty-two seconds since there was any, and the
-- port dropped it. A block is looked at again once `restock_every()` has gone
-- by, and what is standing in it counts against the target, so what goes out
-- is the shortfall.

/** How long before a block's wildlife is looked at again: fifty minutes. */
create or replace function restock_every() returns double precision
  language sql immutable as $fn$ select 3000::double precision $fn$;

/**
 * Ground in this block that suits a species, or nothing.
 *
 * The same three questions the stocking loop asks of a tile it picked itself:
 * that a creature can stand there, that it is not underwater or on somebody's
 * deed, and that the species settles on that sort of ground.
 *
 * The first two are about ground rather than about the species, so a tile that
 * fails them does not count as a look: on an island that is mostly sea most of
 * a block can be water, and eight throws into the water is not eight goes at
 * finding metal. So it counts *looks at ground a creature could stand on*, up
 * to `p_tries` of them, and gives up after three times that many throws.
 */
create or replace function site_for(p_world uuid, p_x0 int, p_y0 int, p_w int, p_h int,
                                    p_species text, p_tries int default 8)
  returns table (x int, y int) language plpgsql as $fn$
declare i int; v_x int; v_y int; v_looks int := 0;
begin
  for i in 1 .. greatest(1, p_tries) * 3 loop
    exit when v_looks >= greatest(1, p_tries);
    v_x := p_x0 + floor(random() * p_w)::int;
    v_y := p_y0 + floor(random() * p_h)::int;
    if not creature_tile_ok(p_world, v_x, v_y) then continue; end if;
    if centre_height(p_world, v_x, v_y) < 2 or on_deed(p_world, v_x, v_y) then continue; end if;
    v_looks := v_looks + 1;
    if not suits(p_world, p_species, v_x, v_y) then continue; end if;
    x := v_x;
    y := v_y;
    return next;
    return;
  end loop;
end $fn$;

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
  v_want := (ceil(v_w / 32.0) * ceil(v_h / 32.0))::int;
  if v_size <= v_block then v_want := greatest(32, v_want); end if;
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

CREATE OR REPLACE FUNCTION public.creature_stock_near(p_world uuid, p_x double precision, p_y double precision)
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
declare v_block int := stock_block(); v_bx int; v_by int;
begin
  v_bx := floor(p_x / v_block)::int;
  v_by := floor(p_y / v_block)::int;
  -- One indexed row, which is the whole cost on the usual answer: this block
  -- has been put out and is not due to be looked at again yet.
  if exists (select 1 from world_stocked s where s.world_id = p_world and s.bx = v_bx and s.by = v_by
             and s.at > now() - make_interval(secs => restock_every())) then
    return 0;
  end if;
  return creature_stock_block(p_world, v_bx, v_by);
end $function$;

select private.lock_doors();
