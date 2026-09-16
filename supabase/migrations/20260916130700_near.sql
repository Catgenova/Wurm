-- What the island costs is the creatures near you, not the creatures on it.
--
-- Both of the hot creature queries read every creature row on the island and
-- threw nearly all of them away, and both now run once a second per player —
-- `rpc_creatures` because the browser asks, `creature_sweep` because the clock
-- does. Measured on one island with 4,134 creatures on it:
--
--     creature_sweep    Seq Scan   4,132 rows removed   120 buffers   0.56 ms
--     rpc_creatures     Seq Scan   4,130 rows removed   120 buffers   1.51 ms
--
-- Two milliseconds to find six creatures, and it is O(players x creatures) in
-- aggregate: at fifty people that is a tenth of a core spent on wildlife, and
-- it grows as the product of the two numbers rather than either.
--
-- Nothing could serve them. `creature_by_world` is `(world_id, mode)`, so the
-- world narrows and then everything else is a filter — and where a creature
-- *is* is a point on the leg it is walking, four columns and the clock, which
-- is not something a btree can look up at all. `rpc_creatures` was working
-- that out for four thousand rows in order to keep four.
--
-- ## The box
--
-- So both narrow first on where the leg *ends*, which is one index away, and
-- then work the exact answer out for the handful that survives. `leg_slack`
-- is what makes the first a superset of the second, and it is enormous on
-- purpose: sixty-four tiles, against a longest leg of 2.13 measured on a real
-- island, and `creature_sweep` has bounded itself this way since it was
-- written — with eight. After:
--
--     creature_sweep    Index Scan    9 buffers   0.05 ms    11x
--     rpc_creatures     Index Scan   22 buffers   0.25 ms     6x
--
-- The constants are the smaller half of it. The shape is the point: neither
-- query grows with the island any more.
--
-- `creature_sweep` keeps the square it always had — `greatest(abs(dx),
-- abs(dy)) <= r` *is* a box — written as two ranges, because a function of a
-- column is not something an index can be asked about and a pair of
-- `between`s is.
--
-- ## And two things about the clock, now it comes round every second
--
-- `pg_cron` starts a job on its schedule whether or not the last one has
-- finished. Nothing here could settle a job twice even so — `settle` takes
-- `for update` and re-checks `act_ends` — but two rounds fighting over the
-- same rows is work neither needed. A round that finds the clock already
-- turning goes back to bed; what it would have done is due again in a second.
--
-- And the sweep ran once per player, so a crowd at a token or a mine face
-- swept the same ground a dozen times. It dedupes on the tile now, which is
-- the conservative reading — two people standing together cost one sweep, two
-- a tile apart still cost two, and nothing that was stirred stops being
-- stirred. The index took most of that win before this line did.

create index if not exists creature_at on creature (world_id, to_x, to_y);

CREATE OR REPLACE FUNCTION public.creature_sweep(p_world uuid, p_x double precision, p_y double precision, p_range double precision DEFAULT 40)
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
declare r record; n int := 0;
begin
  for r in select id from creature
    where world_id = p_world
      -- The same square as before, written as two ranges so `creature_at` can
      -- serve it. `greatest(abs(dx), abs(dy)) <= r` *is* the box; a function
      -- of a column is not something a btree can look up, and a pair of
      -- `between`s is.
      and to_x between p_x - (p_range + leg_slack()) and p_x + (p_range + leg_slack())
      and to_y between p_y - (p_range + leg_slack()) and p_y + (p_range + leg_slack())
      and until <= now()
    order by id limit 120
  loop
    if creature_settle(p_world, r.id) then n := n + 1; end if;
  end loop;
  return n;
end $function$;

CREATE OR REPLACE FUNCTION public.rpc_creatures(p_world uuid, p_range double precision DEFAULT 40)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare me uuid := auth.uid(); p player;
begin
  if me is null then raise exception 'not signed in'; end if;
  if too_fast(me) then raise exception 'you are asking too quickly; slow down'; end if;
  select * into p from player where world_id = p_world and uid = me;
  if not found then raise exception 'you are not on this island'; end if;
  perform creature_sweep(p_world, p.x, p.y, p_range);
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', c.id, 'species', c.species, 'name', c.name, 'variant', c.variant,
      'mode', c.mode, 'stance', c.stance,
      'x', creature_x(c), 'y', creature_y(c),
      'fromX', c.from_x, 'fromY', c.from_y, 'toX', c.to_x, 'toY', c.to_y,
      /*
       * How long the leg is and how much of it is left, in seconds.
       *
       * It used to hand over the two instants themselves, which asks a browser
       * to agree with this database about what time it is. A phone whose clock
       * is twenty seconds out pins every leg at one end or the other and then
       * re-pins it on the next answer, which reads as a thing jumping about —
       * and the action bar learnt this lesson already: "a browser whose clock
       * is a minute out still draws the right bar".
       */
      'legFor', case when c.leg_ends > c.leg_at
                     then extract(epoch from (c.leg_ends - c.leg_at)) else 0 end,
      'legLeft', greatest(0, extract(epoch from (c.leg_ends - now()))),
      'health', c.health, 'max', max_health(c), 'hunger', c.hunger,
      'sex', c.sex, 'age', age_of(c.born), 'traits', c.traits,
      'hunting', c.hunting = me, 'mine', coalesce(c.keeper = me, false))
      /*
       * And, for your own only, what the card has been making up.
       *
       * A worker's trade, its learning, its brushing and what is in its arms
       * are all here and none of them have ever gone out, so the browser
       * filled them in from the book: every wildermon on an island read
       * Foraging 1.00, Experience 0.0, Care 0% and "Looking for work", however
       * long it had been at it. Yours only, because it is a card you open
       * about your own and nobody needs five numbers about a wild boar.
       */
      || case when c.keeper = me then jsonb_build_object(
           'care', c.care, 'xp', c.xp, 'skills', c.skills,
           'phase', c.phase, 'carrying', c.carrying)
         else '{}'::jsonb end
      order by c.id)
    from creature c
    where c.world_id = p_world
      /*
       * Where the leg ends, first, because that is what there is an index on.
       *
       * The exact answer below is where the thing is *now*, which is a point
       * on the leg it is walking and so a function of four columns and the
       * clock — nothing a btree can help with, and it was being worked out for
       * every creature on the island before being thrown away. This narrows to
       * the neighbourhood first, generously: `leg_slack` is far longer than
       * any leg the rules make (the longest measured on a real island is 2.13
       * tiles), and anything walking further than that in one leg was already
       * invisible to `creature_sweep`, which has bounded itself this way since
       * it was written.
       */
      and c.to_x between p.x - (p_range + leg_slack()) and p.x + (p_range + leg_slack())
      and c.to_y between p.y - (p_range + leg_slack()) and p.y + (p_range + leg_slack())
      and greatest(abs(creature_x(c) - p.x), abs(creature_y(c) - p.y)) <= p_range), '[]'::jsonb);
end $function$;

CREATE OR REPLACE FUNCTION public.world_tick()
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
declare w record; p record;
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
    v_gone := v_gone + log_out_idle(w.id);

    if v_tidy then
      v_said := v_said + prune_events(w.id);
      v_folded := v_folded + compact_changes(w.id);
    end if;
  end loop;

  if v_tidy then v_sunk := reap_islands(); end if;

  perform pg_advisory_unlock(hashtext('world_tick')::bigint);
  return jsonb_build_object('worlds', v_worlds, 'settled', v_settled,
                            'stirred', v_stirred, 'sprung', v_sprung, 'left', v_gone,
                            'swept', v_said, 'folded', v_folded, 'sunk', v_sunk);
end $function$;
select private.lock_doors();
