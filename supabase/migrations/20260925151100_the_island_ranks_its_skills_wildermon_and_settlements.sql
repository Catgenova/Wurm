/*
 * The island ranks its skills, its wildermon and its settlements.
 *
 * Asked for: "Island leaderboards. Top skills, best-bred wildermon, biggest
 * settlements."
 *
 * One door, `rpc_boards`, answers all three at once, each cut at
 * `board_top()` places -- `BOARD_TOP` in `src/game/boards.ts` -- for anybody
 * with a body on the island:
 *
 * - **Skills.** For every skill anybody on the island has raised, who holds it
 *   highest. A row in `skill` exists only once a skill has been raised, so
 *   nobody is ranked in a skill they have never used. A body's skills are
 *   private -- `skill_read` lets a player read their own rows and nobody
 *   else's -- which is why this is a security definer, and why it hands out a
 *   name and a figure a place and nothing more. One pass over the island's
 *   skill rows, windowed by skill: a query a skill would read the same rows
 *   once for every skill there is.
 *
 * - **Best-bred wildermon.** Every tamed one -- anything with a keeper whose
 *   mode is not `wild` -- by its traits added up, each counted at
 *   `grade_step(tier)`, which is the browser's `GRADE_STEP`: the steps a
 *   trait's worth climbs by, so the board ranks blood the way the blood pays.
 *   A tie goes to the higher level, which is how the Wildermon window's own
 *   trait order breaks one. Wild ones are left out: a wild birth sets `born`
 *   too, so bred against caught is not a thing the island knows, and what
 *   nobody has tamed is nobody's to be ranked by.
 *
 *   A place names the keeper, the creature, its kind and its score, and never
 *   a trait. `blood_read` shows a keeper only the traits their husbandry can
 *   read, and a board anybody may open would otherwise read every herd on the
 *   island for them.
 *
 * - **Biggest settlements.** By level, then citizens -- the founder and
 *   everybody on the roll -- then age, the oldest first.
 *
 * Each place carries `mine`, so the window can pick out your own.
 *
 * ## What it reads
 *
 * What it ranks, and no more: this island's skill rows and nobody else's; the
 * kept creatures, through `creature_by_keeper`, which leaves the wild ones
 * unread, and `trait_def` once for all of them; its deeds, and one count of
 * their rolls. Names are looked up after the cut, once a person, rather than
 * once for every row read.
 */

create or replace function rpc_boards(p_world uuid) returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare me uuid := auth.uid(); v_top int := board_top();
begin
  if me is null then raise exception 'not signed in'; end if;
  if too_fast(me) then raise exception 'you are asking too quickly; slow down'; end if;
  if not exists (select 1 from player where world_id = p_world and uid = me) then
    raise exception 'you are not on this island';
  end if;
  return jsonb_build_object(
    'skills', (
      with placed as (
        select s.id, s.uid, s.value,
               row_number() over (partition by s.id order by s.value desc, s.uid) as n
          from skill s
         where s.world_id = p_world
      ), kept as (
        select * from placed where n <= v_top
      ), named as materialized (
        -- Materialized, or the planner folds it into the join and asks for a
        -- name once a place rather than once a person.
        select u.uid, folk_name(p_world, u.uid) as name from (select distinct k.uid from kept k) u
      )
      select coalesce(jsonb_object_agg(b.id, b.places), '{}'::jsonb)
        from (select k.id, jsonb_agg(jsonb_build_object(
                       'name', nm.name, 'value', k.value, 'mine', k.uid = me) order by k.n) as places
                from kept k join named nm on nm.uid = k.uid
               group by k.id) b),
    'wildermon', (
      -- Every trait's step, read once for the lot: joined per creature, the
      -- whole of `trait_def` was read again for every animal in the herd.
      with step as materialized (
        select d.id, grade_step(d.tier) as step from trait_def d
      )
      select coalesce(jsonb_agg(jsonb_build_object(
          'keeper', folk_name(p_world, b.keeper), 'name', b.name, 'species', b.species,
          'score', b.score, 'mine', b.keeper = me) order by b.n), '[]'::jsonb)
        from (select c.keeper, c.name, c.species, g.score,
                     row_number() over (order by g.score desc, creature_level(c.skills) desc, c.id) as n
                from creature c
                cross join lateral (
                  select coalesce(sum(st.step), 0) as score
                    from unnest(c.traits) t(id) join step st on st.id = t.id) g
               where c.world_id = p_world and c.keeper is not null and c.mode <> 'wild'
               order by n limit v_top) b),
    'settlements', (
      select coalesce(jsonb_agg(jsonb_build_object(
          'name', r.name, 'founder', folk_name(p_world, r.founded_by), 'level', r.level,
          'citizens', r.citizens, 'mine', r.mine) order by r.n), '[]'::jsonb)
        from (select d.name, d.founded_by, d.level, 1 + coalesce(m.n, 0) as citizens,
                     d.founded_by = me or coalesce(m.me_in, false) as mine,
                     row_number() over (order by d.level desc, coalesce(m.n, 0) desc,
                                                 d.founded_at, d.founded_by) as n
                from deed d
                left join (select dm.founder, count(*)::int as n, bool_or(dm.uid = me) as me_in
                             from deed_member dm
                            where dm.world_id = p_world and dm.uid <> dm.founder
                            group by dm.founder) m on m.founder = d.founded_by
               where d.world_id = p_world
               order by n limit v_top) r));
end $fn$;

notify pgrst, 'reload schema';
select private.lock_doors();
