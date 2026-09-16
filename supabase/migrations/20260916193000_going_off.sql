-- Two more rules the island kept and never ran.
--
-- ## A body that ate well got nothing for it
--
-- `upkeep_mul` — what a full table takes off the pace hunger and thirst come
-- on at — was crossed from the browser the day nutrition was written, and
-- `body_settle` never read it. Nor did anything decay what was on the table,
-- so once ported the other way round one good dinner would have fed a body for
-- the rest of its life. Both, together.
--
-- And `wind_walk()`, crossed the same day and called by nothing: a body that
-- walked all day got its wind back as fast as one sitting down. The island
-- cannot watch your feet between beats, so it asks the one thing it does know
-- — whether the body moved at all during the stretch being settled.
--
-- ## And nothing has ever gone off
--
-- `item_def.decay` is real data — food rots in about half an hour, a tool
-- lasts most of a day — and `groundDecayRate` is real arithmetic on top of it,
-- with quality, material and rarity all in. **Neither side has ever called
-- it.** A haunch of meat dropped in a field was still a haunch of meat a week
-- later, on the island and in a game with no island under it.
--
-- Only what is on the ground, which is what the rule has always said it was
-- about: a crate is a roof and a pack is a pair of hands, and nothing rots in
-- either. That is what a crate is *for*.
--
-- The sweep is bounded like every other one — a slice of rows a round, oldest
-- stamp first — and a thing that has never been swept is stamped rather than
-- charged, so nothing pays for the time before this migration landed.

alter table item add column if not exists rot_at timestamptz;

/** What hunger and thirst fall by, against their ordinary pace. */
create or replace function upkeep_mul(p jsonb) returns double precision
  language sql immutable as $fn$ select 1 - kept_best() * nutrition_fedness(p) $fn$;

/**
 * Damage an hour for a thing lying on the ground.
 *
 * Better quality holds up longer, and what it is made of decides the rest: a
 * cedar chest left in the rain is still a chest a long time after the pine one
 * has gone. The browser has had this arithmetic since the day items were
 * written and neither side ever called it — so on an island a haunch of meat
 * dropped in a field was still a haunch of meat a week later.
 *
 * Only what is on the ground. A crate is a roof, and a pack is a pair of
 * hands: nothing rots in either, which is what a crate is *for*.
 */
create or replace function ground_decay_rate(it item) returns double precision
  language sql stable as $fn$
  select coalesce(d.decay, (select c.per_hour from category_decay c where c.category = d.category), 12)
       * greatest(0.3, 1.4 - it.ql / 120)
       * coalesce((select m.decay from material_def m where m.id = it.extra), 1)
       * rarity_keep(it.rare)
    from item_def d where d.id = it.def
$fn$;

/**
 * Age what is lying about, and take away what has gone.
 *
 * Bounded like every other sweep: a slice of rows a round, oldest stamp first,
 * so an island with ten thousand things on the floor drains over a minute
 * rather than holding the clock up for one of them. A thing that has never
 * been swept is stamped rather than charged — it pays from the first sweep
 * that sees it, not from the beginning of the world.
 */
create or replace function ground_sweep(p_world uuid) returns integer
  language plpgsql as $fn$
declare v_n int;
begin
  with due as (
    select i.id from item i
     where i.world_id = p_world and i.holder = 'ground'
     order by i.rot_at nulls first, i.id
     limit sweep_rows()
  )
  update item i set
      dmg = least(100, i.dmg + case when i.rot_at is null then 0
                   else ground_decay_rate(i) * extract(epoch from (now() - i.rot_at)) / 3600 end),
      rot_at = now()
    from due where i.id = due.id;
  get diagnostics v_n = row_count;
  delete from item where world_id = p_world and holder = 'ground' and dmg >= 100;
  return v_n;
end $fn$;

CREATE OR REPLACE FUNCTION public.body_settle(p_world uuid, p_uid uuid)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare p player; secs double precision;
        h double precision; t double precision; w double precision; hp double precision;
begin
  select * into p from player where world_id = p_world and uid = p_uid for update;
  if not found then return; end if;
  secs := least(body_gap(), extract(epoch from (now() - p.body_at)));
  if secs <= 0 then
    update player set body_at = now() where world_id = p_world and uid = p_uid;
    return;
  end if;
  h := coalesce((p.stats->>'hunger')::double precision, 1);
  t := coalesce((p.stats->>'thirst')::double precision, 1);
  w := coalesce((p.stats->>'stamina')::double precision, 1);
  hp := coalesce((p.stats->>'health')::double precision, 1);

  /*
   * What is on your table, which holds hunger and thirst off.
   *
   * `upkeep_mul` reads the *average* of the four, so anything at all in you
   * helps and a full table helps most. `kept_best` has been crossed from the
   * browser since nutrition was written and nothing on this island read it, so
   * a body that ate well got nothing for it but the bar going up once.
   */
  h := greatest(0, h - secs * hunger_rate() * upkeep_mul(p.nutrition));
  t := greatest(0, t - secs * thirst_rate() * upkeep_mul(p.nutrition));
  if p.act is null then
    /*
     * And your wind, which comes back slower on the move.
     *
     * `wind_walk()` was crossed the day the body was and called by nothing, so
     * a body that walked all day got its wind back as fast as one sitting
     * down. The island cannot watch your feet between beats, so it asks the
     * one thing it does know: whether the body moved at all during the stretch
     * this is settling. Moved in it, walked through it.
     */
    w := least(1, w + secs
           * (case when p.moved_at > p.body_at then wind_walk() else wind_rest() end)
           * (1 + greatest(0, skill_of(p_world, p_uid, 'body_stamina') - char_start()) * wind_per_level())
           * (case when h <= 0 or t <= 0 then wind_starving() else 1 end));
  end if;
  if h > heal_fed() and t > heal_fed() and hp < 1 then
    hp := least(1, hp + secs * heal_rate());
  end if;

  /*
   * And the rest banked by a night in a bed, which burns while you work.
   *
   * `rest_bonus()` was crossed from the browser the day sleeping was ported
   * and nothing ever called it, so the rest went in and never came out: a body
   * that had slept once carried it for ever, and would have carried a doubled
   * rate for ever the moment anything spent it. It burns a second a second,
   * and only while there is a job in hand — standing about is not work.
   */
  if p.act is not null and coalesce(p.rested, 0) > 0 then
    update player set rested = greatest(0, p.rested - secs)
      where world_id = p_world and uid = p_uid;
    if p.rested - secs <= 0 then
      perform tell(p_world, p_uid,
        'The rest goes out of you. Skills go in at their ordinary pace again.', 'system');
    end if;
  end if;

  /*
   * And what is on the table going off, which nothing here did either.
   *
   * `nutrient_decay` is a full measure falling away to nothing over fifty
   * minutes of world time. Without it one good dinner fed a body for the rest
   * of its life, which would have been the reward for porting `upkeep_mul`
   * above rather than a rule.
   */
  if p.nutrition is not null and p.nutrition <> '{}'::jsonb then
    update player set nutrition = (
        select jsonb_object_agg(k, greatest(0, (p.nutrition->>k)::double precision - secs * nutrient_decay()))
          from jsonb_object_keys(p.nutrition) k)
      where world_id = p_world and uid = p_uid;
  end if;

  update player set body_at = now(), stats = jsonb_set(jsonb_set(jsonb_set(jsonb_set(
      coalesce(stats, '{}'::jsonb),
      '{hunger}', to_jsonb(h)), '{thirst}', to_jsonb(t)),
      '{stamina}', to_jsonb(w)), '{health}', to_jsonb(hp))
    where world_id = p_world and uid = p_uid;
end $function$;

CREATE OR REPLACE FUNCTION public.world_tick()
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
declare v_rotted int := 0; w record; p record;
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
                            'swept', v_said, 'folded', v_folded, 'sunk', v_sunk);
end $function$;

notify pgrst, 'reload schema';
