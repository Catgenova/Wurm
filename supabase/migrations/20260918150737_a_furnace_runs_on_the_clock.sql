-- A furnace runs on the island's clock, and one ore is one lump
--
-- Reported from the island: a stone smelter working iron stuck at fifteen
-- seconds left, and stopped for good when a log went in. Measured, the
-- island only ever moved a furnace's work when somebody asked it a question
-- about that furnace: `furnace_settle` ran from the refusal check of an aimed
-- action and from nowhere else, so between two such questions the row said
-- whatever the last answer had been. The browser counted the job down on its
-- own clock and every look at the ground snapped it back to the row. A log
-- fed mid-job was such a question, so the row was brought up to date at that
-- instant, and then held there; which read, exactly, as stopping when the log
-- went in. The clock's round sweeps every lit furnace with work in it now
-- (`furnace_sweep`), so the row is never more than a second behind, and the
-- browser stops making lumps of its own on an island.
--
-- And asked for: one ore is one lump (`ore_per_lump`, now one). What differs
-- between the metals is the lump, a kilo of iron and a tenth of one of gold,
-- which the item table has said all along.

/** Every lit furnace with work in it, brought up to the clock. Returns what came out. */
create or replace function furnace_sweep(p_world uuid) returns integer language plpgsql as $fn$
declare r record; n int := 0;
begin
  for r in select id from placed
           where world_id = p_world and kind in ('smelter', 'kiln') and lit
             and jsonb_array_length(coalesce(state->'jobs', '[]'::jsonb)) > 0
           order by id
  loop
    n := n + furnace_settle(p_world, r.id);
  end loop;
  return n;
end $fn$;

CREATE OR REPLACE FUNCTION public.world_tick()
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
declare v_rotted int := 0; w record; p record; v_lit int := 0; v_fired int := 0;
        v_worlds int := 0; v_settled int := 0; v_stirred int := 0;
        v_sprung int := 0; v_gone int := 0;
        v_said int := 0; v_folded int := 0; v_sunk int := 0;
        v_tidy boolean := false;
begin
  /*
   * One round at a time.
   *
   * `pg_cron` starts a job on its schedule whether or not the last one has
   * finished, and at a second there is far less room than there was at five.
   * Nothing here can settle a job twice — `settle` takes `for update` on the
   * player row and re-checks `act_ends <= now()` — but two rounds fighting
   * over the same rows is work neither of them needed to do. A round that
   * finds the clock already turning goes back to bed; its work is due again
   * in a second.
   */
  if not pg_try_advisory_lock(hashtext('world_tick')::bigint) then
    return jsonb_build_object('worlds', 0, 'busy', true);
  end if;

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

    /*
     * The country round everybody still on their feet — once per patch of it.
     *
     * A crowd at a token or a mine face is a dozen bodies on one tile, and
     * this swept the same ground for each of them. Deduping on the tile is the
     * conservative version of that: two people standing together cost one
     * sweep, two people a tile apart still cost two, and nothing that was
     * being stirred stops being stirred. The index under the sweep took most
     * of this win before this line did — it is a tenth of a millisecond now
     * rather than half of one — so the safe reading is the right one.
     */
    for p in select distinct floor(x) as x, floor(y) as y from player
      where world_id = w.id and not away
        and seen_at > now() - make_interval(secs => idle_logout())
      order by 1, 2 limit tick_players()
    loop
      v_stirred := v_stirred + creature_sweep(w.id, p.x, p.y);
    end loop;

    v_sprung := v_sprung + trap_sweep(w.id) + post_sweep(w.id);
    -- And the braziers, which take at dusk and are raked out at dawn.
    v_lit := v_lit + brazier_sweep(w.id);
    -- And the furnaces, which used to move only when somebody asked them a question.
    v_fired := v_fired + furnace_sweep(w.id);
    -- And what is lying about, going off where it lies.
    v_rotted := v_rotted + ground_sweep(w.id);
    v_gone := v_gone + log_out_idle(w.id);

    if v_tidy then
      v_said := v_said + prune_events(w.id);
      v_folded := v_folded + compact_changes(w.id);
    end if;
  end loop;

  if v_tidy then v_sunk := reap_islands(); end if;

  perform pg_advisory_unlock(hashtext('world_tick')::bigint);
  return jsonb_build_object('worlds', v_worlds, 'settled', v_settled, 'rotted', v_rotted,
                            'stirred', v_stirred, 'sprung', v_sprung, 'left', v_gone,
                            'swept', v_said, 'folded', v_folded, 'sunk', v_sunk,
                            'braziers', v_lit, 'fired', v_fired);
end $function$

;

select private.lock_doors();
