-- Which island the front door opens on.
--
-- Coming ashore has always needed somebody to hand you an id: `?island=<uuid>`
-- in the address bar, or nothing, in which case the page played the
-- single-player game it has always had. That was right while an island was an
-- addition. It is wrong now that the island *is* the game — a front door that
-- needs a uuid typed into it is not a front door.
--
-- So the keeper knows which island is the one. One row, and nothing a browser
-- can write: whoever could set this could point everybody at an island of
-- their own.
create table if not exists home (
  one boolean primary key default true check (one),
  island uuid references world(id) on delete set null
);
alter table home enable row level security;
drop policy if exists home_read on home;
create policy home_read on home for select to anon, authenticated using (true);

/*
 * Point it at the island that is already there.
 *
 * The biggest ready one, which on the live project is the 4096 `Wildermon`
 * that `tools/found-island.ts` laid down. The smoke test founds and abandons
 * 64-tile islands on every run, so size is what tells the island apart from
 * the traffic. On a database with no island at all this sets null and the
 * front door says so rather than pretending.
 */
insert into home (one, island)
  values (true, (select id from world where ready order by size desc, made_at asc limit 1))
  on conflict (one) do update set island = coalesce(home.island, excluded.island);

/**
 * Opening an island claims the front door, if nothing holds it.
 *
 * Only when there is no home at all — so this fires on a fresh project and
 * never again — and only for an island bigger than a tab may found. A browser
 * is capped at `FOUND_MAX`, and an island over that came from the tool, which
 * is the difference between "the island this project is for" and "something
 * somebody rolled". It is not a door anybody can walk through twice.
 */
create or replace function rpc_ready(p_world uuid) returns boolean
  language plpgsql security definer set search_path = public as $$
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
  if w.size > found_max() then
    insert into home (one, island) values (true, p_world)
      on conflict (one) do update set island = coalesce(home.island, excluded.island);
  end if;
  return true;
end $$;

/**
 * And the sea does not take the island the front door opens on.
 *
 * Everything else here is reaped after a month with nobody on it, which is
 * exactly what would happen to a home island in a quiet month — and the next
 * visitor would arrive at a project with no island on it at all.
 */
create or replace function reap_islands() returns int language plpgsql as $$
declare v_n int;
begin
  with dead as (
    select w.id from world w
    where w.made_at < now() - make_interval(secs => island_keep())
      and w.id is distinct from (select island from home)
      and not exists (
        select 1 from player p where p.world_id = w.id
          and p.seen_at > now() - make_interval(secs => island_keep()))
    order by w.made_at limit tick_worlds()
  )
  delete from world w using dead where w.id = dead.id;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

select private.lock_doors();
