-- One block, not nine.
--
-- Stocking a block of country costs half a second to a second and a half: an
-- eight kilobyte scanline is detoasted for every dart thrown, and a block over
-- water throws all of them and keeps almost nothing. Nine blocks is five to
-- thirteen seconds, and `rpc_ready` runs behind PostgREST with an eight second
-- statement timeout. Opening the big island died on the last line, with all
-- 130 MB of its land already up:
--
--     the island would not open: canceling statement due to statement timeout
--
-- So: one block. Somebody standing in it can see about thirty tiles and the
-- block is two hundred and fifty-six across, so the edge of what is stocked is
-- never anywhere near the edge of what is visible — and `rpc_move` is called
-- twice a second, so the moment anybody crosses into new country it is put out
-- before they have taken two steps into it.
--
-- And a tighter budget for the darts. Forty tries per animal was generous when
-- a try was cheap; twelve fills good ground just as well and caps the bad case
-- — a block that is mostly sea — at about a third of a second instead of a
-- second and a half. Fewer animals where there is less land to hold them is
-- the right answer anyway.

create or replace function creature_stock_block(p_world uuid, p_bx int, p_by int) returns int
  language plpgsql as $$
declare v_size int; v_block int := stock_block(); v_want int; v_placed int := 0; v_tries int := 0;
        v_x int; v_y int; v_got text; v_x0 int; v_y0 int; v_w int; v_h int;
begin
  select w.size into v_size from world w where w.id = p_world;
  if v_size is null then return 0; end if;
  v_x0 := p_bx * v_block;
  v_y0 := p_by * v_block;
  if v_x0 < 0 or v_y0 < 0 or v_x0 >= v_size or v_y0 >= v_size then return 0; end if;

  insert into world_stocked (world_id, bx, by) values (p_world, p_bx, p_by) on conflict do nothing;
  if not found then return 0; end if;

  v_w := least(v_block, v_size - v_x0);
  v_h := least(v_block, v_size - v_y0);
  v_want := (ceil(v_w / 32.0) * ceil(v_h / 32.0))::int;
  if v_size <= v_block then v_want := greatest(32, v_want); end if;
  while v_placed < v_want and v_tries < v_want * 12 loop
    v_tries := v_tries + 1;
    v_x := v_x0 + floor(random() * v_w)::int;
    v_y := v_y0 + floor(random() * v_h)::int;
    if not creature_tile_ok(p_world, v_x, v_y) then continue; end if;
    if centre_height(p_world, v_x, v_y) < 2 or on_deed(p_world, v_x, v_y) then continue; end if;
    v_got := pick_wild(p_world, v_x, v_y);
    if v_got is null or not suits(p_world, v_got, v_x, v_y) then continue; end if;
    -- Born at some point in the past, so the country is not all yearlings.
    perform creature_spawn(p_world, v_got, v_x + 0.5, v_y + 0.5, 'wild',
      now() - make_interval(secs => random() * 6 * 3600 * 1.6));
    v_placed := v_placed + 1;
  end loop;
  return v_placed;
end $$;

/**
 * The block somebody is standing in, put out if it never has been.
 *
 * One row looked up, and on the usual answer — it is already out — that is the
 * whole of the cost. `rpc_move` calls this on every step.
 */
create or replace function creature_stock_near(p_world uuid, p_x double precision, p_y double precision) returns int
  language plpgsql as $$
declare v_block int := stock_block(); v_bx int; v_by int;
begin
  v_bx := floor(p_x / v_block)::int;
  v_by := floor(p_y / v_block)::int;
  if exists (select 1 from world_stocked s where s.world_id = p_world and s.bx = v_bx and s.by = v_by) then
    return 0;
  end if;
  return creature_stock_block(p_world, v_bx, v_by);
end $$;

select private.lock_doors();
