/*
 * Islands that go: the live test's after a day, a founding that never opened
 * after a day, one nobody ever came ashore on after a week, and the rest after
 * a month with nobody on them, as before.
 *
 * Asked for, of the live project: "Clean up after the CI test" -- seven
 * islands called "CI 2026-09-17T20:38" and the like, founded by the smoke
 * test between 09-17 and 09-20, are still on it -- and "Retire islands nobody
 * plays".
 *
 * The smoke test gives its island up in a `finally`, and that is skipped when
 * the founding fails halfway (the id was never handed back), when leaving
 * throws first, when `rpc_abandon` meets the clock and loses, or when the
 * process dies outright. Every run signs in as a new anonymous account, so
 * nothing can give one up afterwards either, and the month's rule is the only
 * thing that ever would have. So:
 *
 * - An island can be founded to last a while: `rpc_found` takes `p_lasts`,
 *   in seconds, at most `island_keep()`, and the test asks for
 *   TRIAL_ISLAND_LASTS. Past it the island goes whoever is on it.
 * - A founding that is still shut `island_unopened_keep()` on goes. Nobody
 *   can come ashore on an island before it opens.
 * - An island nobody has ever come ashore on goes `island_unvisited_keep()`
 *   after it was made.
 * - The home island never goes, as before.
 *
 * `island_goes_at` says when that is for any island, and `reap_islands` takes
 * the islands whose time has come, so the deploy's readout and the rule are
 * the same sum. And the seven: an island whose name is exactly what the test
 * calls its own, 64 tiles or smaller, is given the test's day from when it was
 * made, and goes at the next tidy.
 *
 * Three tables kept an island's id with no foreign key -- `bridge_span`,
 * `friend` and `letter` -- so an island that went left their rows behind.
 * They go with it now.
 */
set local lock_timeout = '3s';

alter table world add column if not exists lasts_until timestamptz;

delete from bridge_span s where not exists (select 1 from world w where w.id = s.world_id);
delete from friend f where not exists (select 1 from world w where w.id = f.world_id);
delete from letter l where not exists (select 1 from world w where w.id = l.world_id);
alter table bridge_span drop constraint if exists bridge_span_world_fk;
alter table bridge_span add constraint bridge_span_world_fk
  foreign key (world_id) references world(id) on delete cascade;
alter table friend drop constraint if exists friend_world_fk;
alter table friend add constraint friend_world_fk
  foreign key (world_id) references world(id) on delete cascade;
alter table letter drop constraint if exists letter_world_fk;
alter table letter add constraint letter_world_fk
  foreign key (world_id) references world(id) on delete cascade;

/*
 * When an island goes, or null if it never does. The least of whichever rules
 * apply to it; `least` and `greatest` pass over a null, which is what makes a
 * rule that does not apply drop out.
 */
create or replace function island_goes_at(p_world uuid) returns timestamptz
language sql stable as $$
  select case when w.id is not distinct from (select h.island from home h) then null
    else least(
      w.lasts_until,
      case when not w.ready then w.made_at + make_interval(secs => island_unopened_keep()) end,
      case when not exists (select 1 from player p where p.world_id = w.id)
           then w.made_at + make_interval(secs => island_unvisited_keep()) end,
      greatest(w.made_at, (select max(p.seen_at) from player p where p.world_id = w.id))
        + make_interval(secs => island_keep()))
    end
  from world w where w.id = p_world
$$;

create or replace function reap_islands() returns int language plpgsql as $$
declare v_n int;
begin
  with dead as (
    select w.id from world w
     where island_goes_at(w.id) <= now()
     order by island_goes_at(w.id), w.made_at
     limit tick_worlds()
  )
  delete from world w using dead where w.id = dead.id;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

/*
 * Start an island. It is not playable until the land has arrived.
 *
 * `p_lasts`, when given, is how many seconds it is kept for whoever is on it;
 * the live test's island is kept a day in case the test dies before it can
 * give it up. The old signature is dropped rather than overloaded, so a call
 * that leaves it out still finds exactly one function.
 */
drop function if exists rpc_found(text, bigint, int, int, int);
create or replace function rpc_found(p_name text, p_seed bigint, p_size int,
                                     p_spawn_x int, p_spawn_y int, p_lasts int default null)
  returns uuid language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); w uuid;
begin
  if me is null then raise exception 'not signed in'; end if;
  if p_size < 8 or p_size > 4096 then raise exception 'that is not a size of island'; end if;
  if p_lasts is not null and (p_lasts < 60 or p_lasts > island_keep()) then
    raise exception 'an island is kept between a minute and % days', round(island_keep() / 86400);
  end if;
  insert into world (name, seed, size, spawn_x, spawn_y, ready, made_by, lasts_until)
  values (coalesce(nullif(trim(p_name), ''), 'An island'), p_seed, p_size, p_spawn_x, p_spawn_y, false, me,
          case when p_lasts is not null then now() + make_interval(secs => p_lasts) end)
  returning id into w;
  perform land_blank(w, p_size);
  return w;
end $$;

-- The seven, and any other the test left: named as the test names its island,
-- and no bigger than the test makes one.
update world
   set lasts_until = made_at + interval '1 day'
 where lasts_until is null
   and name ~ '^CI [0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}$'
   and size <= 64;

select private.lock_doors();
