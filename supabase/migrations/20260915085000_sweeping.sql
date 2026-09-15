-- Three things that grew and nothing ever shrank.
--
-- `event` is one row per line of feedback per person, kept for ever, and
-- nobody has ever read their own backlog. `tile_change` is one row per dug
-- tile, kept for ever, and it is also what a joining client replays — so it
-- could not simply be aged out. And a `world` row nobody has stood on since
-- the spring still holds its thirty-six megabytes of land, out of the eight
-- gigabytes the plan includes; two hundred and twenty-seven abandoned islands
-- would fill it.

/** When the keeper last did the tidying, as against the settling. */
create table if not exists keeper (
  one boolean primary key default true check (one),
  swept_at timestamptz not null default to_timestamp(0)
);
insert into keeper (one) values (true) on conflict do nothing;
alter table keeper enable row level security;

/* ------------------------------------------------------------------ *
 * Talk.
 * ------------------------------------------------------------------ */

/** Lines older than `event_keep`, a bounded bite at a time. */
create or replace function prune_events(p_world uuid) returns int language plpgsql as $$
declare v_n int;
begin
  with old as (
    select world_id, n from event
    where world_id = p_world and at < now() - make_interval(secs => event_keep())
    order by n limit sweep_rows()
  )
  delete from event e using old where e.world_id = old.world_id and e.n = old.n;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

/* ------------------------------------------------------------------ *
 * Ground.
 * ------------------------------------------------------------------ */

/**
 * Collapse the history of a tile to where that tile ended up.
 *
 * `tile_change` cannot be aged out. It is what a client replays to catch up,
 * and a row dropped is a patch of ground somebody never hears about — the
 * client would generate that square from the seed and draw grass over a
 * quarry.
 *
 * It can be *compacted*, and losslessly, because replaying diffs in order only
 * the last one for a given tile decides where that tile ends up. Everything
 * older than `change_keep` collapses to one row per tile, and a client
 * replaying from any cursor lands on exactly the same island it would have.
 * The intermediate states go; nothing has ever wanted them.
 *
 * Rows inside the keep window are left alone, so somebody who dropped off an
 * hour ago still gets the history in the order it happened.
 */
create or replace function compact_changes(p_world uuid) returns int language plpgsql as $$
declare v_n int;
begin
  with ranked as (
    select world_id, n,
           row_number() over (partition by x, y order by n desc) as newest
    from tile_change
    where world_id = p_world and at < now() - make_interval(secs => change_keep())
  ), stale as (
    select world_id, n from ranked where newest > 1 order by n limit sweep_rows()
  )
  delete from tile_change t using stale where t.world_id = stale.world_id and t.n = stale.n;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

/* ------------------------------------------------------------------ *
 * Islands.
 * ------------------------------------------------------------------ */

/**
 * An island nobody has stood on for a month goes back to the sea.
 *
 * Thirty-six megabytes of land each, against the eight gigabytes the plan
 * includes. An island still being laid down — founded but never opened, which
 * is what a failed founding leaves behind — counts as abandoned on the same
 * clock.
 *
 * Deliberately not part of the per-island round below: a dead island is
 * exactly the one the clock never visits.
 */
create or replace function reap_islands() returns int language plpgsql as $$
declare v_n int;
begin
  with dead as (
    select w.id from world w
    where w.made_at < now() - make_interval(secs => island_keep())
      and not exists (
        select 1 from player p where p.world_id = w.id
          and p.seen_at > now() - make_interval(secs => island_keep()))
    order by w.made_at limit tick_worlds()
  )
  delete from world w using dead where w.id = dead.id;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

/* ------------------------------------------------------------------ *
 * And the round, which now tidies as well as settles.
 * ------------------------------------------------------------------ */

create or replace function world_tick() returns jsonb language plpgsql as $$
declare w record; p record;
        v_worlds int := 0; v_settled int := 0; v_stirred int := 0;
        v_sprung int := 0; v_gone int := 0;
        v_said int := 0; v_folded int := 0; v_sunk int := 0;
        v_tidy boolean := false;
begin
  -- The tidying is not the settling and does not want the settling's pace: a
  -- scan every five seconds to delete nothing is just a scan.
  update keeper set swept_at = now()
    where one and swept_at < now() - make_interval(secs => sweep_every());
  v_tidy := found;

  for w in
    select id from world where ready and exists (
      select 1 from player
      where player.world_id = world.id and not player.away
        and player.seen_at > now() - make_interval(secs => idle_logout()))
    order by id limit tick_worlds()
  loop
    v_worlds := v_worlds + 1;

    -- Everything anybody has finished doing, and the next go of it.
    for p in select uid from player
      where world_id = w.id and act is not null and act_ends <= now()
      order by uid limit tick_players()
    loop
      v_settled := v_settled + settle(w.id, p.uid);
    end loop;

    -- The country round everybody still on their feet.
    for p in select uid, x, y from player
      where world_id = w.id and not away
        and seen_at > now() - make_interval(secs => idle_logout())
      order by uid limit tick_players()
    loop
      v_stirred := v_stirred + creature_sweep(w.id, p.x, p.y);
    end loop;

    v_sprung := v_sprung + trap_sweep(w.id) + post_sweep(w.id);
    v_gone := v_gone + log_out_idle(w.id);

    if v_tidy then
      v_said := v_said + prune_events(w.id);
      v_folded := v_folded + compact_changes(w.id);
    end if;
  end loop;

  if v_tidy then v_sunk := reap_islands(); end if;

  return jsonb_build_object('worlds', v_worlds, 'settled', v_settled,
                            'stirred', v_stirred, 'sprung', v_sprung, 'left', v_gone,
                            'swept', v_said, 'folded', v_folded, 'sunk', v_sunk);
end $$;

select private.lock_doors();
