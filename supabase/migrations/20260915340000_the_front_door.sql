-- A front door that opens on the island you just founded.
--
-- Founding a new island has not moved the front door since the door was put
-- in. `rpc_ready` claimed it with
--
--     on conflict (one) do update set island = coalesce(home.island, excluded.island)
--
-- and said so plainly: "Only when there is no home at all — so this fires on a
-- fresh project and never again. It is not a door anybody can walk through
-- twice." That was written to stop a stray founding stealing the door, and it
-- does — along with every deliberate one. Two islands were founded and opened
-- today and the door stayed where it was, so the land everybody actually walks
-- on is still whatever `20260915111500_home.sql` picked when it ran: the
-- earliest-made ready island, which is the oldest ground on the project rather
-- than the newest.
--
-- The guard that was doing the real work is the size. A browser may not found
-- anything over `found_max()` (512), and the live smoke test founds sixty-four
-- tiles on every run and gives them back. Nothing but the tool, run on purpose
-- at a size no tab can reach, can produce an island over that — and running
-- the tool on purpose is exactly what refounding *is*. So the size keeps the
-- traffic out and the door moves.
--
-- And it moves now, to the newest island over that size, because the one
-- founded tonight is already standing open with nobody able to reach it
-- without a uuid in the address bar. `coalesce` on the way in, so a project
-- with no such island keeps whatever door it had rather than losing it.

CREATE OR REPLACE FUNCTION public.rpc_ready(p_world uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare me uuid := auth.uid(); w world;
begin
  if me is null then raise exception 'not signed in'; end if;
  select * into w from world where id = p_world;
  if not found then raise exception 'no such island'; end if;
  if w.made_by is distinct from me then raise exception 'that is not your island to open'; end if;
  if (select count(*) from land_corner where world_id = p_world) <> w.size + 1
     or (select count(*) from land_tile where world_id = p_world) <> w.size then
    raise exception 'the land is not all here yet';
  end if;
  update world set ready = true where id = p_world;
  perform creature_stock_near(p_world, w.spawn_x + 0.5, w.spawn_y + 0.5);
  -- An island the tool laid down takes the door, every time. `found_max` is
  -- what tells one apart from the traffic: a browser may not found anything
  -- over it, and the live smoke test founds sixty-four tiles and gives them
  -- back. So the only thing that can move this is somebody deliberately
  -- running the tool at a size no tab can reach, which is what refounding is.
  if w.size > found_max() then
    insert into home (one, island) values (true, p_world)
      on conflict (one) do update set island = excluded.island;
  end if;
  return true;
end $function$;


-- The door, where it should already have been.
update home set island = coalesce(
  (select id from world where ready and size > found_max() order by made_at desc limit 1),
  island);

select private.lock_doors();
